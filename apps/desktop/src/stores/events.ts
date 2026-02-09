import { createSignal } from "solid-js";
import { apiFetch, AuthError } from "../lib/api";
import { isAuthenticated } from "./auth";
import { getWeekId, getWeekBounds, getWeeksInRange } from "../lib/date-utils";
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
  location?: string;
  description?: string;
}

// =============================================================================
// Configuration
// =============================================================================
const DAYS_BEFORE = 7;
const DAYS_AFTER = 30;

// =============================================================================
// Signals
// =============================================================================
export const [events, setEvents] = createSignal<CalendarEvent[]>([]);
export const [isLoading, setIsLoading] = createSignal(false);
export const [lastRefreshed, setLastRefreshed] = createSignal<Date | null>(null);
export const [eventsError, setEventsError] = createSignal<string | null>(null);
export const [fetchedWeeks, setFetchedWeeks] = createSignal<Set<string>>(new Set());
const [fetchingWeeks, setFetchingWeeks] = createSignal<Set<string>>(new Set());

// =============================================================================
// Request Tracking
// =============================================================================
let currentRequestId = 0;

// =============================================================================
// Cross-module registrations
//
// event-deletion.ts and event-polling.ts register their functions here at
// import time. This breaks circular imports: events.ts never imports from
// those modules, they import from events.ts and call these registration fns.
// =============================================================================

let _pendingDeletionMap: Map<string, unknown> = new Map();
let _revalidateWeeksForDates: ((...dates: Date[]) => void) | null = null;
let _setVisibleWeeksForPolling: ((weeks: Set<string>) => void) | null = null;

/** Called by event-deletion.ts to share its pendingMap reference. */
export function _registerPendingMap(map: Map<string, unknown>): void {
  _pendingDeletionMap = map;
}

/** Called by event-polling.ts to share its revalidation + visibility functions. */
export function _registerPollingFns(fns: {
  revalidateWeeksForDates: (...dates: Date[]) => void;
  setVisibleWeeksForPolling: (weeks: Set<string>) => void;
}): void {
  _revalidateWeeksForDates = fns.revalidateWeeksForDates;
  _setVisibleWeeksForPolling = fns.setVisibleWeeksForPolling;
}

// =============================================================================
// Helpers (some exported for use by event-polling)
// =============================================================================

function formatDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function convertApiEvent(event: ApiCalendarEvent): CalendarEvent {
  return {
    id: event.id,
    calendarId: event.calendarId,
    title: event.title,
    start: new Date(event.start),
    end: new Date(event.end),
    isAllDay: event.isAllDay,
    color: event.color,
    location: event.location,
    description: event.description,
  };
}

function getTimeWindow(): { timeMin: string; timeMax: string } {
  const now = new Date();
  const min = new Date(now);
  min.setDate(min.getDate() - DAYS_BEFORE);
  min.setHours(0, 0, 0, 0);

  const max = new Date(now);
  max.setDate(max.getDate() + DAYS_AFTER);
  max.setHours(23, 59, 59, 999);

  return { timeMin: min.toISOString(), timeMax: max.toISOString() };
}

function processEvents(
  newEvents: CalendarEvent[],
  existingEvents: CalendarEvent[] = []
): CalendarEvent[] {
  const uniqueEvents = new Map<string, CalendarEvent>();
  for (const event of existingEvents) {
    if (!_pendingDeletionMap.has(event.id)) uniqueEvents.set(event.id, event);
  }
  for (const event of newEvents) {
    if (!_pendingDeletionMap.has(event.id)) uniqueEvents.set(event.id, event);
  }
  return Array.from(uniqueEvents.values()).sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );
}

/**
 * Replace events that overlap with a time range instead of additive merge.
 * Events overlapping the range that are absent from the new response are removed,
 * ensuring deletions on the server propagate to the client cache.
 */
export function replaceEventsInRange(
  rangeStart: Date,
  rangeEnd: Date,
  newEvents: CalendarEvent[],
  existingEvents: CalendarEvent[]
): CalendarEvent[] {
  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime();

  // Filter out events pending local deletion — server still has them
  // but the user already deleted them (undo window hasn't closed yet)
  const filtered = newEvents.filter((e) => !_pendingDeletionMap.has(e.id));
  const newEventIds = new Set(filtered.map((e) => e.id));

  const kept = existingEvents.filter((event) => {
    if (_pendingDeletionMap.has(event.id)) return false;
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

export async function refreshEvents(window?: { start: Date; end: Date }): Promise<void> {
  if (!isAuthenticated()) {
    setEvents([]);
    return;
  }

  const { timeMin, timeMax } = window
    ? { timeMin: window.start.toISOString(), timeMax: window.end.toISOString() }
    : getTimeWindow();

  // Show cached events immediately (stale-while-revalidate)
  const cachedEvents = await loadEventsFromDisk(timeMin, timeMax);
  if (cachedEvents.length > 0) {
    setEvents(processEvents(cachedEvents, events()));
  }

  if (!window && cachedEvents.length === 0) {
    setIsLoading(true);
  }
  setEventsError(null);

  try {
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
    await replaceEventsOnDisk(timeMin, timeMax, apiEvents);
  } catch (error) {
    if (cachedEvents.length === 0) {
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

    refreshEvents();
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
  const newVisible = new Set(weeks);
  const fetching = fetchingWeeks();
  const staleFetches: string[] = [];

  for (const week of fetching) {
    if (!newVisible.has(week)) {
      staleFetches.push(week);
    }
  }

  if (staleFetches.length > 0) {
    console.log(`[events] Cancelling stale fetches:`, staleFetches);
    currentRequestId++;
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

  _setVisibleWeeksForPolling?.(newVisible);
}

export async function fetchEventsForWeek(weekId: string): Promise<void> {
  if (!isAuthenticated()) return;
  if (fetchingWeeks().has(weekId)) {
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
    _revalidateWeeksForDates?.(new Date());
    return;
  }

  const requestId = currentRequestId;
  setFetchingWeeks((prev) => new Set([...prev, weekId]));
  console.log(`[events] Fetching ${weekId}...`);

  try {
    const { start, end } = getWeekBounds(weekId);
    const apiEvents = await apiFetch<ApiCalendarEvent[]>(
      `/api/events?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`
    );

    if (requestId !== currentRequestId) {
      console.log(`[events] Discarding stale fetch for ${weekId}`);
      return;
    }

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

// =============================================================================
// Optimistic Local Events
// =============================================================================

/**
 * Add an event locally (optimistic UI).
 * Used for newly created events before server confirmation.
 */
export function addLocalEvent(event: CalendarEvent): void {
  setEvents((prev) => processEvents([event], prev));
}

/**
 * Remove an event locally by ID.
 * Used when creation is cancelled or deletion succeeds.
 */
export function removeLocalEvent(eventId: string): void {
  setEvents((prev) => prev.filter((e) => e.id !== eventId));
}

// =============================================================================
// Event Updates (Optimistic)
// =============================================================================

export type EventPatch = {
  title?: string;
  description?: string;
  location?: string;
  start?: Date;
  end?: Date;
  isAllDay?: boolean;
};

/**
 * Update an event optimistically: apply patch locally, then PATCH API.
 * On failure, rollback to the snapshot.
 */
export async function updateEvent(eventId: string, patch: EventPatch): Promise<void> {
  const event = events().find((e) => e.id === eventId);
  if (!event) return;

  // Snapshot for rollback
  const snapshot = { ...event };

  // Apply optimistic update
  setEvents((prev) =>
    prev.map((e) =>
      e.id === eventId
        ? {
            ...e,
            ...(patch.title !== undefined && { title: patch.title }),
            ...(patch.description !== undefined && { description: patch.description }),
            ...(patch.location !== undefined && { location: patch.location }),
            ...(patch.start !== undefined && { start: patch.start }),
            ...(patch.end !== undefined && { end: patch.end }),
            ...(patch.isAllDay !== undefined && { isAllDay: patch.isAllDay }),
          }
        : e
    )
  );

  // Build API patch body
  const apiPatch: Record<string, string | boolean> = {};
  if (patch.title !== undefined) apiPatch.summary = patch.title;
  if (patch.description !== undefined) apiPatch.description = patch.description;
  if (patch.location !== undefined) apiPatch.location = patch.location;
  if (patch.isAllDay !== undefined) apiPatch.isAllDay = patch.isAllDay;
  if (patch.start !== undefined) {
    apiPatch.start = patch.isAllDay
      ? formatDateOnly(patch.start)
      : patch.start.toISOString();
  }
  if (patch.end !== undefined) {
    apiPatch.end = patch.isAllDay
      ? formatDateOnly(patch.end)
      : patch.end.toISOString();
  }

  try {
    await apiFetch(`/api/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      body: JSON.stringify(apiPatch),
    });
    _revalidateWeeksForDates?.(event.start, patch.start ?? event.start);
  } catch (error) {
    console.error(`[events] Failed to update event ${eventId}:`, error);
    // Rollback
    setEvents((prev) =>
      prev.map((e) => (e.id === eventId ? snapshot : e))
    );
  }
}

// Re-export week utilities for convenience
export { getWeekId, getWeekBounds, getWeeksInRange };
