import { createSignal } from "solid-js";
import { apiFetch, AuthError } from "../lib/api";
import { isAuthenticated } from "./auth";
import { getWeekBounds, getWeeksInRange } from "../lib/date-utils";
import {
  loadWeekFetchTimes,
  recordWeekAccess,
  recordWeeksAccess,
  recordWeekFetch,
  recordWeeksFetch,
  isWeekStale,
  calculateEviction,
  cleanupEvictedWeeks,
  filterEventsForWeeks,
  deleteEvictedWeeksFromDisk,
  loadEventsFromDisk,
  replaceEventsOnDisk,
} from "../lib/event-cache";
import type { ApiCalendarEvent } from "@cathrin/shared-types";
import { TEMP_EVENT_TTL_MS } from "../constants/calendar";
import { isSeriesDirty, clearDirtyIfMatching } from "./event-dirty";
import type { CalendarEvent } from "./event-types";
import { convertApiEvent } from "./event-types";
import {
  events,
  setEvents,
  isLoading,
  setIsLoading,
  setLastRefreshed,
  setEventsError,
  fetchedWeeks,
  setFetchedWeeks,
  getPendingDeletionMap,
  getRevalidateWeeksForDates,
  getSetVisibleWeeksForPolling,
} from "./events";
import { dragActiveEventId } from "./event-drag";
import { centerDate } from "./calendar-navigation";

// =============================================================================
// Configuration
// =============================================================================
const DAYS_BEFORE = 7;
const DAYS_AFTER = 30;

// =============================================================================
// Signals (private to this module)
// =============================================================================
const [fetchingWeeks, setFetchingWeeks] = createSignal<Set<string>>(new Set());
const inflightWeeks = new Set<string>(); // Synchronous dedup (signals batch updates)

// =============================================================================
// Helpers
// =============================================================================

function getTimeWindow(): { timeMin: string; timeMax: string } {
  // Use the current center date (restored from last session or today)
  const center = centerDate();
  const min = new Date(center);
  min.setDate(min.getDate() - DAYS_BEFORE);
  min.setHours(0, 0, 0, 0);

  const max = new Date(center);
  max.setDate(max.getDate() + DAYS_AFTER);
  max.setHours(23, 59, 59, 999);

  return { timeMin: min.toISOString(), timeMax: max.toISOString() };
}

export function processEvents(
  newEvents: CalendarEvent[],
  existingEvents: CalendarEvent[] = []
): CalendarEvent[] {
  const pendingMap = getPendingDeletionMap();
  const uniqueEvents = new Map<string, CalendarEvent>();
  for (const event of existingEvents) {
    if (!pendingMap.has(event.id)) uniqueEvents.set(event.id, event);
  }
  for (const event of newEvents) {
    if (!pendingMap.has(event.id)) uniqueEvents.set(event.id, event);
  }
  return Array.from(uniqueEvents.values()).sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );
}

/**
 * Replace events that overlap with a time range instead of additive merge.
 * Events overlapping the range that are absent from the new response are removed,
 * ensuring deletions on the server propagate to the client cache.
 *
 * Events currently being dragged are protected: the local (drag-modified) version
 * is always preserved, and the server version is excluded from the merge. This
 * prevents async fetch responses from clobbering in-progress drag state.
 */
export function replaceEventsInRange(
  rangeStart: Date,
  rangeEnd: Date,
  newEvents: CalendarEvent[],
  existingEvents: CalendarEvent[]
): CalendarEvent[] {
  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime();
  const pendingMap = getPendingDeletionMap();
  const dragId = dragActiveEventId();

  // Identify series with pending recurrence mutations (dirty flag).
  // Server data for these series is likely stale (eventual consistency),
  // so we exclude server instances for dirty series entirely.
  const protectedSeriesIds = new Set<string>();
  for (const event of existingEvents) {
    if (event.id.includes("-rrule-") && event.recurringEventId
        && isSeriesDirty(event.recurringEventId)) {
      protectedSeriesIds.add(event.recurringEventId);
    }
  }

  // Filter out events pending local deletion — server still has them
  // but the user already deleted them (undo window hasn't closed yet).
  // Also exclude the dragged event from server data so it can't overwrite
  // the local drag-modified version during processEvents merge.
  // Also exclude server instances for series with protected RRULE instances
  // to prevent stale Google data from creating duplicates.
  const filtered = newEvents.filter(
    (e) => !pendingMap.has(e.id) && e.id !== dragId
      && !(e.recurringEventId && protectedSeriesIds.has(e.recurringEventId)),
  );
  const newEventIds = new Set(filtered.map((e) => e.id));

  // Collect recurringEventIds from server response to detect when server has expanded a series
  const serverRecurringIds = new Set(
    filtered.filter(e => e.recurringEventId).map(e => e.recurringEventId!)
  );

  // Clear dirty flags before the `kept` filter below. If the server returned a master
  // with matching recurrence, its expanded instances in `filtered` are authoritative,
  // so `isSeriesDirty()` below correctly drops optimistic instances in the same pass.
  for (const event of filtered) {
    if (event.recurrence && event.recurrence.length > 0) {
      const seriesId = event.providerEventId || event.id;
      clearDirtyIfMatching(seriesId, event.recurrence);
    }
  }

  const kept = existingEvents.filter((event) => {
    // Never touch the event being dragged — its local state is authoritative
    if (dragId && event.id === dragId) return true;
    if (pendingMap.has(event.id)) return false;

    // Preserve temp recurring instances whose series hasn't arrived from server yet
    if (event.id.startsWith("temp-") && event.recurringEventId
        && !serverRecurringIds.has(event.recurringEventId)) {
      // Purge stale temp instances past TTL
      if (event.createdAt && Date.now() - event.createdAt.getTime() > TEMP_EVENT_TTL_MS) {
        return false;
      }
      return true;
    }
    // Also preserve temp master events (have recurrence but no recurringEventId)
    if (event.id.startsWith("temp-") && event.recurrence && !event.recurringEventId) {
      if (event.createdAt && Date.now() - event.createdAt.getTime() > TEMP_EVENT_TTL_MS) {
        return false;
      }
      return true;
    }

    // Preserve optimistic RRULE-expanded instances (from recurrence edits)
    // until server returns matching instances for the same series.
    // These have IDs like "{eventId}-rrule-{date}" and are created by
    // updateEvent() when changing recurrence on a series.
    if (event.id.includes("-rrule-") && event.recurringEventId) {
      if (!serverRecurringIds.has(event.recurringEventId)) {
        return true;
      }
      // Keep optimistic instances while the series is dirty (mutation not
      // yet confirmed or server hasn't returned matching recurrence).
      if (isSeriesDirty(event.recurringEventId)) {
        return true;
      }
    }

    const overlaps =
      event.start.getTime() <= endMs && event.end.getTime() >= startMs;
    return !overlaps || newEventIds.has(event.id);
  });

  return processEvents(filtered, kept);
}

function evictStaleWeeks(): void {
  const currentWeeks = fetchedWeeks();
  const { weeksToKeep, evictedWeeks } = calculateEviction(currentWeeks);

  if (evictedWeeks.length > 0) {
    console.log(`[events] Evicting ${evictedWeeks.length} stale weeks:`, evictedWeeks);
    cleanupEvictedWeeks(evictedWeeks);
    setFetchedWeeks(weeksToKeep);
    setEvents((prev) => filterEventsForWeeks(prev, weeksToKeep));
    deleteEvictedWeeksFromDisk(evictedWeeks);
  }
}

// =============================================================================
// Public API
// =============================================================================

export async function refreshEvents(
  window?: { start: Date; end: Date },
  skipDiskLoad?: boolean,
): Promise<void> {
  if (!isAuthenticated()) {
    setEvents([]);
    return;
  }

  console.log("[events] Refreshing in background...");

  const { timeMin, timeMax } = window
    ? { timeMin: window.start.toISOString(), timeMax: window.end.toISOString() }
    : getTimeWindow();

  setEventsError(null);
  let hasCachedData = events().length > 0;

  try {
    // Show cached events immediately (stale-while-revalidate).
    // Skip disk load when caller already loaded cache (e.g. initializeEvents).
    if (!skipDiskLoad) {
      const cachedEvents = await loadEventsFromDisk(timeMin, timeMax);
      if (cachedEvents.length > 0) {
        setEvents(processEvents(cachedEvents, events()));
        hasCachedData = true;
      }
    }

    if (!window && !hasCachedData) {
      setIsLoading(true);
    }

    const apiEvents = await apiFetch<ApiCalendarEvent[]>(
      `/api/events?from=${encodeURIComponent(timeMin)}&to=${encodeURIComponent(timeMax)}`
    );

    const newEvents = apiEvents.map(convertApiEvent);
    const now = new Date();

    if (window) {
      const weeksInWindow = getWeeksInRange(new Date(timeMin), new Date(timeMax));
      recordWeeksAccess(weeksInWindow);
      recordWeeksFetch(weeksInWindow);
      setEvents((prev) =>
        replaceEventsInRange(new Date(timeMin), new Date(timeMax), newEvents, prev)
      );
      setFetchedWeeks((prev) => {
        const updated = new Set(prev);
        for (const weekId of weeksInWindow) {
          updated.add(weekId);
        }
        return updated;
      });
      evictStaleWeeks();
    } else {
      setEvents(processEvents(newEvents, []));
    }

    setLastRefreshed(now);
    // Skip writing events from dirty series to disk — their server data
    // may be stale (eventual consistency) and would overwrite good local state.
    const cleanApiEvents = apiEvents.filter(
      (e) => !e.recurringEventId || !isSeriesDirty(e.recurringEventId),
    );
    await replaceEventsOnDisk(timeMin, timeMax, cleanApiEvents);
  } catch (error) {
    if (!hasCachedData) {
      if (error instanceof AuthError) {
        setEventsError("Please reconnect your account");
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        setEventsError(errorMessage || "Failed to refresh events");
      }
    } else {
      console.log("[events] Using cached data (offline or server error)");
    }
  } finally {
    setIsLoading(false);
  }
}

export async function initializeEvents(): Promise<void> {
  if (isAuthenticated()) {
    await loadWeekFetchTimes();

    const defaultWindow = getTimeWindow();
    const cached = await loadEventsFromDisk(defaultWindow.timeMin, defaultWindow.timeMax);
    if (cached.length > 0) {
      setEvents(processEvents(cached, []));
    }

    refreshEvents(undefined, true).catch((error) => {
      console.error("[events] Background refresh failed:", error);
    });
  }
}

export function getFetchedWeeks(): Set<string> {
  return fetchedWeeks();
}

export function getFetchingWeeks(): Set<string> {
  return fetchingWeeks();
}

export function isLoadingWeeks(): boolean {
  return isLoading() || fetchingWeeks().size > 0;
}

export function getStaleWeeks(weekIds: string[]): string[] {
  return weekIds.filter((weekId) => fetchedWeeks().has(weekId) && isWeekStale(weekId));
}

export function updateVisibleWeeks(weeks: string[]): void {
  getSetVisibleWeeksForPolling()?.(new Set(weeks));
}

export async function fetchEventsForWeek(weekId: string): Promise<void> {
  if (!isAuthenticated()) return;
  if (inflightWeeks.has(weekId)) {
    console.log(`[events] Skipping ${weekId} - already fetching`);
    return;
  }

  const isFetched = fetchedWeeks().has(weekId);
  const stale = isWeekStale(weekId);

  if (isFetched && !stale) {
    console.log(`[events] Skipping ${weekId} - fresh cache`);
    return;
  }

  if (isFetched && stale) {
    const { start } = getWeekBounds(weekId);
    getRevalidateWeeksForDates()?.(start);
    return;
  }

  inflightWeeks.add(weekId);
  setFetchingWeeks((prev) => new Set([...prev, weekId]));
  console.log(`[events] Fetching ${weekId}...`);

  try {
    const { start, end } = getWeekBounds(weekId);
    const apiEvents = await apiFetch<ApiCalendarEvent[]>(
      `/api/events?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`
    );

    const newEvents = apiEvents.map(convertApiEvent);
    recordWeekAccess(weekId);
    recordWeekFetch(weekId);
    setEvents((prev) => replaceEventsInRange(start, end, newEvents, prev));
    setFetchedWeeks((prev) => new Set([...prev, weekId]));
    evictStaleWeeks();
    console.log(`[events] Fetched ${weekId} - ${newEvents.length} events`);
  } catch (error) {
    if (error instanceof AuthError) {
      console.error(`[events] Auth error fetching ${weekId}:`, error);
    } else {
      console.error(`[events] Failed to fetch week ${weekId}:`, error);
    }
  } finally {
    inflightWeeks.delete(weekId);
    setFetchingWeeks((prev) => {
      const updated = new Set(prev);
      updated.delete(weekId);
      return updated;
    });
  }
}

export function getEventsForRange(
  start: Date,
  end: Date
): { events: CalendarEvent[]; missingWeeks: string[] } {
  const weeksNeeded = getWeeksInRange(start, end);
  const cached = fetchedWeeks();
  const missingWeeks = weeksNeeded.filter((week) => !cached.has(week));

  const rangeStart = start.getTime();
  const rangeEnd = end.getTime();
  const eventsInRange = events().filter((event) => {
    const eventStart = event.start.getTime();
    const eventEnd = event.end.getTime();
    return eventStart <= rangeEnd && eventEnd >= rangeStart;
  });

  return { events: eventsInRange, missingWeeks };
}
