import { invoke } from "@tauri-apps/api/core";
import { getWeekId, getWeekBounds, getHotZoneWeeks } from "./date-utils";
import type { CalendarEvent } from "../stores/events";

// =============================================================================
// Cache Configuration
// =============================================================================
const HOT_ZONE_DAYS = 30; // Days each direction from today - never evicted
const MAX_LRU_WEEKS = 50; // Maximum weeks to keep in LRU cache (excluding hot zone)

// Staleness: How long before cached data is considered stale
export const STALE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes

// =============================================================================
// LRU Tracking
// Map of weekId -> last accessed timestamp
// =============================================================================
const weekAccessTimes = new Map<string, number>();

export function recordWeekAccess(weekId: string): void {
  weekAccessTimes.set(weekId, Date.now());
}

export function recordWeeksAccess(weekIds: string[]): void {
  const now = Date.now();
  for (const weekId of weekIds) {
    weekAccessTimes.set(weekId, now);
  }
}

export function clearWeekAccess(weekId: string): void {
  weekAccessTimes.delete(weekId);
}

export function clearAllWeekAccess(): void {
  weekAccessTimes.clear();
}

// =============================================================================
// Staleness Tracking
// Map of weekId -> fetchedAt timestamp
// Persisted to SQLite to survive app restarts
// =============================================================================
const weekFetchTimes = new Map<string, number>();
let fetchTimesLoaded = false;
let persistTimeout: ReturnType<typeof setTimeout> | null = null;

export function isWeekStale(weekId: string): boolean {
  const fetchedAt = weekFetchTimes.get(weekId);
  if (!fetchedAt) return true; // Never fetched = stale
  return Date.now() - fetchedAt > STALE_THRESHOLD_MS;
}

export function recordWeekFetch(weekId: string): void {
  weekFetchTimes.set(weekId, Date.now());
  persistWeekFetchTimes();
}

export function recordWeeksFetch(weekIds: string[]): void {
  const now = Date.now();
  for (const weekId of weekIds) {
    weekFetchTimes.set(weekId, now);
  }
  persistWeekFetchTimes();
}

export function clearWeekFetchTime(weekId: string): void {
  weekFetchTimes.delete(weekId);
}

export function clearAllWeekFetchTimes(): void {
  weekFetchTimes.clear();
  fetchTimesLoaded = false;
}

export function isFetchTimesLoaded(): boolean {
  return fetchTimesLoaded;
}

/**
 * Load week fetch times from SQLite on startup
 * Prevents "startup storm" of revalidation requests
 */
export async function loadWeekFetchTimes(): Promise<void> {
  try {
    const times = await invoke<Array<{ week_id: string; fetched_at: number }>>(
      "get_week_fetch_times"
    );
    for (const { week_id, fetched_at } of times) {
      weekFetchTimes.set(week_id, fetched_at);
    }
    fetchTimesLoaded = true;
    console.log(`[event-cache] Loaded ${times.length} week fetch times from disk`);
  } catch (error) {
    console.warn("[event-cache] Failed to load week fetch times:", error);
    fetchTimesLoaded = true; // Mark as loaded even on error to prevent blocking
  }
}

/**
 * Persist week fetch times to SQLite (debounced)
 */
function persistWeekFetchTimes(): void {
  if (persistTimeout) {
    clearTimeout(persistTimeout);
  }
  persistTimeout = setTimeout(() => {
    const times = Array.from(weekFetchTimes.entries()).map(
      ([week_id, fetched_at]) => ({ week_id, fetched_at })
    );
    invoke("save_week_fetch_times", { times }).catch((error) => {
      console.warn("[event-cache] Failed to persist week fetch times:", error);
    });
  }, 1000); // 1 second debounce
}

export async function clearPersistedFetchTimes(): Promise<void> {
  try {
    await invoke("clear_week_fetch_times");
  } catch (error) {
    console.warn("[event-cache] Failed to clear week fetch times:", error);
  }
}

// =============================================================================
// Eviction Logic
// =============================================================================

export type EvictionResult = {
  weeksToKeep: Set<string>;
  evictedWeeks: string[];
};

/**
 * Calculate which weeks to keep and which to evict using tiered strategy:
 * 1. Hot zone (today +/- HOT_ZONE_DAYS) - never evicted
 * 2. LRU cache - keep most recently accessed weeks up to limit
 */
export function calculateEviction(currentWeeks: Set<string>): EvictionResult {
  const hotZone = getHotZoneWeeks(HOT_ZONE_DAYS);
  const weeksToKeep = new Set<string>(hotZone);

  // Get non-hot-zone weeks sorted by last access time (most recent first)
  const lruCandidates = [...currentWeeks]
    .filter((w) => !hotZone.has(w))
    .sort((a, b) => {
      const aTime = weekAccessTimes.get(a) ?? 0;
      const bTime = weekAccessTimes.get(b) ?? 0;
      return bTime - aTime; // Most recent first
    });

  // Keep up to MAX_LRU_WEEKS non-hot-zone weeks
  const lruToKeep = lruCandidates.slice(0, MAX_LRU_WEEKS);
  for (const weekId of lruToKeep) {
    weeksToKeep.add(weekId);
  }

  const evictedWeeks = [...currentWeeks].filter((w) => !weeksToKeep.has(w));

  return { weeksToKeep, evictedWeeks };
}

/**
 * Clean up tracking data for evicted weeks
 */
export function cleanupEvictedWeeks(evictedWeeks: string[]): void {
  for (const weekId of evictedWeeks) {
    weekAccessTimes.delete(weekId);
    weekFetchTimes.delete(weekId);
  }
  persistWeekFetchTimes();
}

/**
 * Filter events to remove those in evicted weeks
 */
export function filterEventsForWeeks(
  events: CalendarEvent[],
  weeksToKeep: Set<string>
): CalendarEvent[] {
  return events.filter((event) => {
    const weekId = getWeekId(event.start);
    return weeksToKeep.has(weekId);
  });
}

/**
 * Delete events for evicted weeks from SQLite cache
 */
export async function deleteEvictedWeeksFromDisk(weekIds: string[]): Promise<void> {
  try {
    const weekBounds = weekIds.map((weekId) => {
      const { start, end } = getWeekBounds(weekId);
      return {
        start: start.toISOString(),
        end: end.toISOString(),
      };
    });

    const deleted = await invoke<number>("delete_cached_weeks", { weekBounds });
    console.log(`[event-cache] Deleted ${deleted} events from SQLite for ${weekIds.length} evicted weeks`);
  } catch (error) {
    console.warn("[event-cache] Failed to delete evicted weeks from SQLite:", error);
  }
}

// =============================================================================
// SQLite Cache Operations
// =============================================================================

interface CachedEvent {
  id: string;
  calendar_id: string;
  title: string;
  start: string;
  end: string;
  is_all_day: boolean;
  color: string;
  provider: string;
}

export async function loadEventsFromDisk(
  timeMin: string,
  timeMax: string
): Promise<CalendarEvent[]> {
  try {
    const cached = await invoke<CachedEvent[]>("get_local_cached_events", {
      start: timeMin,
      end: timeMax,
    });
    return cached.map((event) => ({
      id: event.id,
      calendarId: event.calendar_id,
      title: event.title,
      start: new Date(event.start),
      end: new Date(event.end),
      isAllDay: event.is_all_day,
      color: event.color,
    }));
  } catch (error) {
    console.warn("[event-cache] Failed to load from cache:", error);
    return [];
  }
}

interface ApiEventForCache {
  id: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  isAllDay: boolean;
  color: string;
  provider: string;
}

export async function saveEventsToDisk(events: ApiEventForCache[]): Promise<void> {
  try {
    const cached = events.map((event) => ({
      id: event.id,
      calendar_id: event.calendarId,
      title: event.title,
      start: event.start,
      end: event.end,
      is_all_day: event.isAllDay,
      color: event.color,
      provider: event.provider,
    }));
    await invoke("cache_events_locally", { events: cached });
  } catch (error) {
    console.warn("[event-cache] Failed to save to cache:", error);
  }
}

/**
 * Replace events in a time range on disk: delete stale, then save fresh.
 * Prevents deleted events from persisting in the SQLite cache across reloads.
 */
/**
 * Delete a single event from the SQLite cache by ID.
 * Used during optimistic deletion to prevent stale flash on app restart.
 */
export async function deleteCachedEventFromDisk(eventId: string): Promise<void> {
  try {
    await invoke("delete_cached_event_by_id", { eventId });
  } catch (error) {
    console.warn("[event-cache] Failed to delete event from cache:", error);
  }
}

/**
 * Restore a single event to the SQLite cache.
 * Used when undoing a deletion.
 */
export async function restoreCachedEventToDisk(event: {
  id: string;
  calendarId: string;
  title: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  color: string;
}): Promise<void> {
  try {
    await invoke("cache_events_locally", {
      events: [
        {
          id: event.id,
          calendar_id: event.calendarId,
          title: event.title,
          start: event.start.toISOString(),
          end: event.end.toISOString(),
          is_all_day: event.isAllDay,
          color: event.color,
          provider: "google",
        },
      ],
    });
  } catch (error) {
    console.warn("[event-cache] Failed to restore event to cache:", error);
  }
}

export async function replaceEventsOnDisk(
  timeMin: string,
  timeMax: string,
  events: ApiEventForCache[]
): Promise<void> {
  try {
    await invoke("delete_cached_weeks", {
      weekBounds: [{ start: timeMin, end: timeMax }],
    });
  } catch (error) {
    console.warn("[event-cache] Failed to clear range from cache:", error);
  }
  await saveEventsToDisk(events);
}
