import { createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { apiFetch, AuthError } from "../lib/api";
import { isAuthenticated } from "./auth";
import {
  getWeekId,
  getWeekBounds,
  getWeeksInRange,
  getHotZoneWeeks,
} from "../lib/date-utils";
import type { ApiCalendarEvent } from "@cathrin/shared-types";

/**
 * Cached event format (matches Rust struct)
 */
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

/**
 * Event data for the frontend, with dates parsed to JS Date objects
 */
export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  color: string;
}

// Time window for fetching events (days relative to now)
const DAYS_BEFORE = 7;
const DAYS_AFTER = 30;

// Tiered cache configuration
const HOT_ZONE_DAYS = 30; // Days each direction from today - never evicted
const MAX_LRU_WEEKS = 50; // Maximum weeks to keep in LRU cache (excluding hot zone)

// Staleness configuration
const STALE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes - revalidate after this

// Signals for events state
export const [events, setEvents] = createSignal<CalendarEvent[]>([]);
export const [isLoading, setIsLoading] = createSignal(false);
export const [lastRefreshed, setLastRefreshed] = createSignal<Date | null>(
  null,
);
export const [eventsError, setEventsError] = createSignal<string | null>(null);

/**
 * Track which weeks have been fetched
 */
const [fetchedWeeks, setFetchedWeeks] = createSignal<Set<string>>(new Set());

/**
 * Track which weeks are currently being fetched (in-flight requests)
 * Prevents duplicate fetches for the same week
 */
const [fetchingWeeks, setFetchingWeeks] = createSignal<Set<string>>(new Set());

/**
 * LRU tracking: Map of weekId -> last accessed timestamp
 * Used to determine which weeks to evict when cache is full
 */
const weekAccessTimes = new Map<string, number>();

/**
 * Staleness tracking: Map of weekId -> fetchedAt timestamp
 * Used to determine if week data needs background revalidation
 */
const weekFetchTimes = new Map<string, number>();

/**
 * Track which weeks are currently being revalidated
 * Prevents duplicate revalidation requests
 */
const [revalidatingWeeks, setRevalidatingWeeks] = createSignal<Set<string>>(
  new Set(),
);

/**
 * Record a week access for LRU tracking
 */
function recordWeekAccess(weekId: string): void {
  weekAccessTimes.set(weekId, Date.now());
}

/**
 * Record access for multiple weeks
 */
function recordWeeksAccess(weekIds: string[]): void {
  const now = Date.now();
  for (const weekId of weekIds) {
    weekAccessTimes.set(weekId, now);
  }
}

/**
 * Record fetch time for staleness tracking
 */
function recordWeekFetch(weekId: string): void {
  weekFetchTimes.set(weekId, Date.now());
}

/**
 * Record fetch times for multiple weeks
 */
function recordWeeksFetch(weekIds: string[]): void {
  const now = Date.now();
  for (const weekId of weekIds) {
    weekFetchTimes.set(weekId, now);
  }
}

/**
 * Check if a week's data is stale and needs revalidation
 */
function isWeekStale(weekId: string): boolean {
  const fetchedAt = weekFetchTimes.get(weekId);
  if (!fetchedAt) return true; // Never fetched = stale
  return Date.now() - fetchedAt > STALE_THRESHOLD_MS;
}

/**
 * Request ID for cancellation pattern
 * Incremented when visible weeks change to invalidate in-flight requests
 */
let currentRequestId = 0;

/**
 * Track which weeks are currently visible (for cancellation)
 */
let currentVisibleWeeks: Set<string> = new Set();

/**
 * Convert API event to frontend CalendarEvent
 */
function convertApiEvent(event: ApiCalendarEvent): CalendarEvent {
  return {
    id: event.id,
    calendarId: event.calendarId,
    title: event.title,
    start: new Date(event.start),
    end: new Date(event.end),
    isAllDay: event.isAllDay,
    color: event.color,
  };
}

/**
 * Get the time window for fetching events
 */
function getTimeWindow(): { timeMin: string; timeMax: string } {
  const now = new Date();

  const min = new Date(now);
  min.setDate(min.getDate() - DAYS_BEFORE);
  min.setHours(0, 0, 0, 0);

  const max = new Date(now);
  max.setDate(max.getDate() + DAYS_AFTER);
  max.setHours(23, 59, 59, 999);

  return {
    timeMin: min.toISOString(),
    timeMax: max.toISOString(),
  };
}

/**
 * Deduplicate and sort events by start time
 */
function processEvents(
  newEvents: CalendarEvent[],
  existingEvents: CalendarEvent[] = [],
): CalendarEvent[] {
  // Deduplicate by event id
  const uniqueEvents = new Map<string, CalendarEvent>();

  // Add existing events first
  for (const event of existingEvents) {
    uniqueEvents.set(event.id, event);
  }

  // Add/overwrite with new events
  for (const event of newEvents) {
    uniqueEvents.set(event.id, event);
  }

  // Sort by start time
  return Array.from(uniqueEvents.values()).sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
}

/**
 * Evict stale weeks from cache using tiered eviction strategy:
 * 1. Hot zone (today ±30 days) - never evicted
 * 2. LRU cache - keep most recently accessed weeks up to limit
 */
function evictStaleWeeks(): void {
  const hotZone = getHotZoneWeeks(HOT_ZONE_DAYS);
  const currentWeeks = fetchedWeeks();

  // Start with hot zone weeks (always kept)
  const toKeep = new Set<string>(hotZone);

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
    toKeep.add(weekId);
  }

  // Calculate evicted weeks for logging
  const evicted = [...currentWeeks].filter((w) => !toKeep.has(w));

  if (evicted.length > 0) {
    console.log(`[events] Evicting ${evicted.length} stale weeks:`, evicted);

    // Clean up tracking for evicted weeks
    for (const weekId of evicted) {
      weekAccessTimes.delete(weekId);
      weekFetchTimes.delete(weekId);
    }

    // Update fetched weeks
    setFetchedWeeks(toKeep);

    // Remove events for evicted weeks
    setEvents((prev) =>
      prev.filter((event) => {
        const weekId = getWeekId(event.start);
        return toKeep.has(weekId);
      }),
    );
  }
}

/**
 * Revalidate a week's data in the background
 * Does not show loading state - stale data remains visible during fetch
 */
async function revalidateWeekBackground(weekId: string): Promise<void> {
  // Skip if already revalidating this week
  if (revalidatingWeeks().has(weekId)) {
    console.log(`[events] Skipping revalidation for ${weekId} - already in progress`);
    return;
  }

  // Mark as revalidating
  setRevalidatingWeeks((prev) => {
    const updated = new Set(prev);
    updated.add(weekId);
    return updated;
  });

  console.log(`[events] Revalidating stale week ${weekId}...`);

  try {
    const { start, end } = getWeekBounds(weekId);
    const timeMin = start.toISOString();
    const timeMax = end.toISOString();

    // Fetch fresh data from server
    const apiEvents = await apiFetch<ApiCalendarEvent[]>(
      `/api/events?from=${encodeURIComponent(timeMin)}&to=${encodeURIComponent(timeMax)}`,
    );

    const newEvents = apiEvents.map(convertApiEvent);

    // Record fresh fetch time
    recordWeekFetch(weekId);
    recordWeekAccess(weekId);

    // Merge fresh events into cache (replaces old events for this week)
    setEvents((prev) => processEvents(newEvents, prev));

    console.log(`[events] Revalidated ${weekId} - ${newEvents.length} events`);
  } catch (error) {
    // Log but don't surface error - stale data is still visible
    console.warn(`[events] Failed to revalidate ${weekId}:`, error);
  } finally {
    // Clear revalidating state
    setRevalidatingWeeks((prev) => {
      const updated = new Set(prev);
      updated.delete(weekId);
      return updated;
    });
  }
}

/**
 * Convert cached event to CalendarEvent
 */
function convertCachedEvent(event: CachedEvent): CalendarEvent {
  return {
    id: event.id,
    calendarId: event.calendar_id,
    title: event.title,
    start: new Date(event.start),
    end: new Date(event.end),
    isAllDay: event.is_all_day,
    color: event.color,
  };
}

/**
 * Convert API event to cached event format
 */
function apiEventToCached(event: ApiCalendarEvent): CachedEvent {
  return {
    id: event.id,
    calendar_id: event.calendarId,
    title: event.title,
    start: event.start,
    end: event.end,
    is_all_day: event.isAllDay,
    color: event.color,
    provider: event.provider,
  };
}

/**
 * Load events from local SQLite cache
 */
async function loadFromCache(
  timeMin: string,
  timeMax: string,
): Promise<CalendarEvent[]> {
  try {
    const cached = await invoke<CachedEvent[]>("get_local_cached_events", {
      start: timeMin,
      end: timeMax,
    });
    return cached.map(convertCachedEvent);
  } catch (error) {
    console.warn("[events] Failed to load from cache:", error);
    return [];
  }
}

/**
 * Save events to local SQLite cache
 */
async function saveToCache(events: ApiCalendarEvent[]): Promise<void> {
  try {
    const cached = events.map(apiEventToCached);
    await invoke("cache_events_locally", { events: cached });
  } catch (error) {
    console.warn("[events] Failed to save to cache:", error);
  }
}

/**
 * Refresh events from sync-server API with stale-while-revalidate
 * Shows cached data immediately, then fetches fresh data in background
 * @param window Optional time window to fetch events for. Defaults to initial window.
 */
export async function refreshEvents(window?: {
  start: Date;
  end: Date;
}): Promise<void> {
  // Skip if not authenticated
  if (!isAuthenticated()) {
    setEvents([]);
    return;
  }

  let timeMin: string;
  let timeMax: string;

  if (window) {
    timeMin = window.start.toISOString();
    timeMax = window.end.toISOString();
  } else {
    const defaultWindow = getTimeWindow();
    timeMin = defaultWindow.timeMin;
    timeMax = defaultWindow.timeMax;
  }

  // 1. Show cached events immediately (stale-while-revalidate)
  const cachedEvents = await loadFromCache(timeMin, timeMax);
  if (cachedEvents.length > 0) {
    setEvents(processEvents(cachedEvents, events()));
  }

  // Only set global loading if we have no cached data
  if (!window && cachedEvents.length === 0) {
    setIsLoading(true);
  }
  setEventsError(null);

  // 2. Fetch fresh data from server
  try {
    const apiEvents = await apiFetch<ApiCalendarEvent[]>(
      `/api/events?from=${encodeURIComponent(timeMin)}&to=${encodeURIComponent(timeMax)}`,
    );

    const newEvents = apiEvents.map(convertApiEvent);

    // Update UI with fresh data
    const now = new Date();
    if (window) {
      // Record access and fetch times for all weeks in the window
      const weeksInWindow = getWeeksInRange(new Date(timeMin), new Date(timeMax));
      recordWeeksAccess(weeksInWindow);
      recordWeeksFetch(weeksInWindow);

      setEvents((prev) => processEvents(newEvents, prev));

      // Mark weeks as fetched
      setFetchedWeeks((prev) => {
        const updated = new Set(prev);
        for (const weekId of weeksInWindow) {
          updated.add(weekId);
        }
        return updated;
      });

      // Evict stale weeks based on tiered cache strategy
      evictStaleWeeks();
    } else {
      setEvents(processEvents(newEvents, []));
    }

    setLastRefreshed(now);

    // 3. Save fresh data to local cache
    await saveToCache(apiEvents);
  } catch (error) {
    // If we have cached data, don't show error (offline mode)
    if (cachedEvents.length === 0) {
      if (error instanceof AuthError) {
        setEventsError("Please reconnect your account");
      } else {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        setEventsError(errorMessage || "Failed to refresh events");
      }
    } else {
      console.log("[events] Using cached data (offline or server error)");
    }
  } finally {
    setIsLoading(false);
  }
}

/**
 * Initialize events: load from cache, then refresh from API
 * Call this on app startup after auth is initialized
 */
export async function initializeEvents(): Promise<void> {
  if (isAuthenticated()) {
    // Load from cache first for instant display
    const defaultWindow = getTimeWindow();
    const cached = await loadFromCache(
      defaultWindow.timeMin,
      defaultWindow.timeMax,
    );
    if (cached.length > 0) {
      setEvents(processEvents(cached, []));
    }

    // Then refresh from server in background
    refreshEvents();
  }
}

/**
 * Get the set of weeks that have been fetched
 */
export function getFetchedWeeks(): Set<string> {
  return fetchedWeeks();
}

/**
 * Get the set of weeks currently being fetched
 */
export function getFetchingWeeks(): Set<string> {
  return fetchingWeeks();
}

/**
 * Check if any weeks are currently being fetched
 * Reactive signal for UI to show loading state
 */
export function isLoadingWeeks(): boolean {
  return fetchingWeeks().size > 0;
}

/**
 * Check if any weeks are currently being revalidated
 */
export function isRevalidatingWeeks(): boolean {
  return revalidatingWeeks().size > 0;
}

/**
 * Get weeks that are stale and need revalidation
 * Useful for periodic polling to know which weeks to refresh
 */
export function getStaleWeeks(weekIds: string[]): string[] {
  return weekIds.filter(
    (weekId) => fetchedWeeks().has(weekId) && isWeekStale(weekId),
  );
}

/**
 * Update visible weeks and cancel fetches for non-visible weeks
 * Call this when visible weeks change to invalidate stale requests
 */
export function updateVisibleWeeks(weeks: string[]): void {
  const newVisible = new Set(weeks);

  // Check if any in-flight fetches are now non-visible
  const fetching = fetchingWeeks();
  const staleFetches: string[] = [];
  for (const week of fetching) {
    if (!newVisible.has(week)) {
      staleFetches.push(week);
    }
  }

  if (staleFetches.length > 0) {
    console.log(`[events] Cancelling stale fetches:`, staleFetches);
    // Increment request ID to invalidate pending responses
    currentRequestId++;
    // Remove stale weeks from fetchingWeeks
    setFetchingWeeks((prev) => {
      const next = new Set<string>();
      for (const week of prev) {
        if (newVisible.has(week)) {
          next.add(week);
        }
      }
      return next;
    });
  }

  currentVisibleWeeks = newVisible;
}

/**
 * Fetch events for a specific week
 * Merges into existing cache rather than replacing
 * Tracks in-flight state to prevent duplicate requests
 * Supports cancellation via request ID pattern
 */
export async function fetchEventsForWeek(weekId: string): Promise<void> {
  // Skip if not authenticated
  if (!isAuthenticated()) {
    return;
  }

  // Skip if already fetching this week
  if (fetchingWeeks().has(weekId)) {
    console.log(`[events] Skipping ${weekId} - already fetching`);
    return;
  }

  const isFetched = fetchedWeeks().has(weekId);
  const isStale = isWeekStale(weekId);

  // If we have cached data that's still fresh, skip
  if (isFetched && !isStale) {
    console.log(`[events] Skipping ${weekId} - fresh cache`);
    return;
  }

  // If we have cached data but it's stale, trigger background revalidation
  if (isFetched && isStale) {
    // Fire and forget - don't await
    revalidateWeekBackground(weekId);
    return;
  }

  // Capture request ID at start
  const requestId = currentRequestId;

  // Mark as fetching
  setFetchingWeeks((prev) => {
    const updated = new Set(prev);
    updated.add(weekId);
    return updated;
  });

  console.log(`[events] Fetching ${weekId}...`);

  try {
    const { start, end } = getWeekBounds(weekId);
    const timeMin = start.toISOString();
    const timeMax = end.toISOString();

    // Fetch events from sync-server
    const apiEvents = await apiFetch<ApiCalendarEvent[]>(
      `/api/events?from=${encodeURIComponent(timeMin)}&to=${encodeURIComponent(timeMax)}`,
    );

    // Check if this request is still relevant before updating state
    if (requestId !== currentRequestId) {
      console.log(
        `[events] Discarding stale fetch for ${weekId} (cancelled after fetch)`,
      );
      return;
    }

    const newEvents = apiEvents.map(convertApiEvent);

    // Record week access for LRU tracking and fetch time for staleness
    recordWeekAccess(weekId);
    recordWeekFetch(weekId);

    // Merge new events with existing
    setEvents((prev) => processEvents(newEvents, prev));

    // Mark week as fetched
    setFetchedWeeks((prev) => {
      const updated = new Set(prev);
      updated.add(weekId);
      return updated;
    });

    // Evict stale weeks based on tiered cache strategy
    evictStaleWeeks();

    console.log(`[events] Fetched ${weekId} - ${newEvents.length} events`);
  } catch (error) {
    if (error instanceof AuthError) {
      console.error(`[events] Auth error fetching ${weekId}:`, error);
    } else {
      console.error(`[events] Failed to fetch week ${weekId}:`, error);
    }
  } finally {
    // Clear fetching state (only if not already cleared by cancellation)
    setFetchingWeeks((prev) => {
      const updated = new Set(prev);
      updated.delete(weekId);
      return updated;
    });
  }
}

/**
 * Get events for a date range, identifying which weeks are missing from cache
 * Returns cached events within the range and a list of weeks that need fetching
 */
export function getEventsForRange(
  start: Date,
  end: Date,
): { events: CalendarEvent[]; missingWeeks: string[] } {
  const weeksNeeded = getWeeksInRange(start, end);
  const cached = fetchedWeeks();

  const missingWeeks = weeksNeeded.filter((week) => !cached.has(week));

  // Filter events to those overlapping the range
  const rangeStart = start.getTime();
  const rangeEnd = end.getTime();

  const eventsInRange = events().filter((event) => {
    const eventStart = event.start.getTime();
    const eventEnd = event.end.getTime();
    // Event overlaps range if it starts before range ends and ends after range starts
    return eventStart <= rangeEnd && eventEnd >= rangeStart;
  });

  return { events: eventsInRange, missingWeeks };
}

/**
 * Clear all events and reset state
 * Call this when user logs out
 */
export function clearEvents(): void {
  setEvents([]);
  setFetchedWeeks(new Set());
  setFetchingWeeks(new Set());
  setRevalidatingWeeks(new Set());
  setLastRefreshed(null);
  setEventsError(null);
  weekAccessTimes.clear();
  weekFetchTimes.clear();
  currentRequestId++;
}

// Re-export week utilities for convenience
export { getWeekId, getWeekBounds, getWeeksInRange };
