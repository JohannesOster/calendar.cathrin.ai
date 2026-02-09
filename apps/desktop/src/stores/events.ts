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
  saveEventsToDisk,
  replaceEventsOnDisk,
  deleteCachedEventFromDisk,
  restoreCachedEventToDisk,
  clearAllWeekAccess,
  clearAllWeekFetchTimes,
  clearPersistedFetchTimes,
  STALE_THRESHOLD_MS,
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

// Polling interval matches staleness threshold for responsive updates
const POLL_INTERVAL_MS = STALE_THRESHOLD_MS;

// =============================================================================
// Signals
// =============================================================================
export const [events, setEvents] = createSignal<CalendarEvent[]>([]);
export const [isLoading, setIsLoading] = createSignal(false);
export const [lastRefreshed, setLastRefreshed] = createSignal<Date | null>(null);
export const [eventsError, setEventsError] = createSignal<string | null>(null);
const [fetchedWeeks, setFetchedWeeks] = createSignal<Set<string>>(new Set());
const [fetchingWeeks, setFetchingWeeks] = createSignal<Set<string>>(new Set());
const [revalidatingWeeks, setRevalidatingWeeks] = createSignal<Set<string>>(new Set());

// =============================================================================
// Request Tracking
// =============================================================================
let currentRequestId = 0;
let currentVisibleWeeks: Set<string> = new Set();
let pollIntervalId: ReturnType<typeof setInterval> | null = null;

// =============================================================================
// Helpers
// =============================================================================

function formatDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function convertApiEvent(event: ApiCalendarEvent): CalendarEvent {
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
 */
function replaceEventsInRange(
  rangeStart: Date,
  rangeEnd: Date,
  newEvents: CalendarEvent[],
  existingEvents: CalendarEvent[]
): CalendarEvent[] {
  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime();

  // Filter out events pending local deletion — server still has them
  // but the user already deleted them (undo window hasn't closed yet)
  const filtered = newEvents.filter((e) => !pendingMap.has(e.id));
  const newEventIds = new Set(filtered.map((e) => e.id));

  const kept = existingEvents.filter((event) => {
    if (pendingMap.has(event.id)) return false;
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
// Revalidation
// =============================================================================

async function revalidateWeekBackground(weekId: string): Promise<void> {
  if (revalidatingWeeks().has(weekId)) {
    console.log(`[events] Skipping revalidation for ${weekId} - already in progress`);
    return;
  }

  setRevalidatingWeeks((prev) => new Set([...prev, weekId]));
  console.log(`[events] Revalidating stale week ${weekId}...`);

  try {
    const { start, end } = getWeekBounds(weekId);
    const apiEvents = await apiFetch<ApiCalendarEvent[]>(
      `/api/events?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`
    );

    const newEvents = apiEvents.map(convertApiEvent);
    recordWeekFetch(weekId);
    recordWeekAccess(weekId);
    setEvents((prev) => replaceEventsInRange(start, end, newEvents, prev));
    console.log(`[events] Revalidated ${weekId} - ${newEvents.length} events`);
  } catch (error) {
    console.warn(`[events] Failed to revalidate ${weekId}:`, error);
  } finally {
    setRevalidatingWeeks((prev) => {
      const updated = new Set(prev);
      updated.delete(weekId);
      return updated;
    });
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

export function isRevalidatingWeeks(): boolean {
  return revalidatingWeeks().size > 0;
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

  currentVisibleWeeks = newVisible;
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
    revalidateWeekBackground(weekId);
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
// Polling
// =============================================================================

async function pollVisibleWeeks(): Promise<void> {
  if (currentVisibleWeeks.size === 0 || !isAuthenticated()) {
    return;
  }

  const staleWeeks = getStaleWeeks([...currentVisibleWeeks]);
  if (staleWeeks.length === 0) {
    return;
  }

  console.log(`[events] Polling ${staleWeeks.length} stale visible weeks:`, staleWeeks);
  await Promise.all(staleWeeks.map(revalidateWeekBackground));
}

/**
 * Force revalidation of all currently visible weeks, regardless of staleness.
 * Used on window focus and network reconnect for immediate freshness.
 */
async function forceRevalidateVisibleWeeks(): Promise<void> {
  if (currentVisibleWeeks.size === 0 || !isAuthenticated()) return;

  const visibleFetched = [...currentVisibleWeeks].filter((w) => fetchedWeeks().has(w));
  if (visibleFetched.length === 0) return;

  console.log(`[events] Force-revalidating ${visibleFetched.length} visible weeks`);
  await Promise.all(visibleFetched.map(revalidateWeekBackground));
}

export function startPolling(): void {
  if (pollIntervalId) return;
  console.log(`[events] Starting polling (interval: ${POLL_INTERVAL_MS / 1000}s)`);
  pollIntervalId = setInterval(() => {
    pollVisibleWeeks().catch((error) => console.warn("[events] Poll failed:", error));
  }, POLL_INTERVAL_MS);
}

export function stopPolling(): void {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
    console.log("[events] Stopped polling");
  }
}

export function isPollingActive(): boolean {
  return pollIntervalId !== null;
}

export function handleVisibilityChange(): void {
  if (document.hidden) {
    stopPolling();
  } else {
    startPolling();
    // Force-revalidate all visible weeks on focus, not just stale ones
    forceRevalidateVisibleWeeks().catch((error) => console.warn("[events] Focus revalidation failed:", error));
  }
}

export function handleOnline(): void {
  if (!isAuthenticated()) return;
  console.log("[events] Network reconnected, revalidating...");
  forceRevalidateVisibleWeeks().catch((error) => console.warn("[events] Online revalidation failed:", error));
}

export function clearEvents(): void {
  stopPolling();
  setEvents([]);
  setFetchedWeeks(new Set<string>());
  setFetchingWeeks(new Set<string>());
  setRevalidatingWeeks(new Set<string>());
  setLastRefreshed(null);
  setEventsError(null);
  clearAllWeekAccess();
  clearAllWeekFetchTimes();
  currentRequestId++;
  clearPersistedFetchTimes();
}

// =============================================================================
// Post-Mutation Revalidation
// =============================================================================

/**
 * Revalidate weeks affected by a mutation (create/delete).
 * Called after API calls succeed to sync optimistic state with server truth.
 */
export function revalidateWeeksForDates(...dates: Date[]): void {
  const weekIds = new Set(dates.map((d) => getWeekId(d)));
  for (const weekId of weekIds) {
    if (fetchedWeeks().has(weekId)) {
      revalidateWeekBackground(weekId);
    }
  }
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
// Event Deletion
// =============================================================================

export interface PendingDeletion {
  event: CalendarEvent;
}

/**
 * Non-reactive map of pending deletions. The toast component subscribes
 * to the `onDeletion` callback to manage its own rendering lifecycle,
 * which prevents store/signal array mutations from recreating sibling toasts.
 */
const pendingMap = new Map<string, PendingDeletion>();

type DeletionListener = (deletion: PendingDeletion) => void;
const listeners = new Set<DeletionListener>();

/** Subscribe to new deletion events (used by UndoToast). */
export function onDeletion(fn: DeletionListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Fire the actual DELETE API call for an event.
 */
function fireDeleteApi(event: CalendarEvent): void {
  apiFetch<{ success: boolean }>(`/api/events/${encodeURIComponent(event.id)}`, {
    method: "DELETE",
  })
    .then(() => {
      console.log(`[events] Deleted event ${event.id} from server`);
      revalidateWeeksForDates(event.start);
    })
    .catch((error) => {
      console.error(`[events] Failed to delete event ${event.id}:`, error);
      // Restore on failure — server didn't accept the deletion
      addLocalEvent(event);
      restoreCachedEventToDisk(event);
    });
}

/**
 * Delete an event: remove from local store + SQLite cache immediately.
 * The API call is deferred until the undo toast dismisses.
 */
export function deleteEvent(eventId: string): void {
  const event = events().find((e) => e.id === eventId);
  if (!event) return;

  const deletion: PendingDeletion = { event };
  pendingMap.set(eventId, deletion);

  // Notify toast component
  for (const fn of listeners) fn(deletion);

  // Optimistic removal from UI + disk cache
  removeLocalEvent(eventId);
  deleteCachedEventFromDisk(eventId);
}

/**
 * Undo a specific pending deletion by event ID.
 */
export function undoDelete(eventId: string): void {
  const pending = pendingMap.get(eventId);
  if (!pending) return;

  pendingMap.delete(eventId);

  // Restore event to UI + disk cache
  addLocalEvent(pending.event);
  restoreCachedEventToDisk(pending.event);
}

/**
 * Confirm a specific pending deletion: fire the API call.
 */
export function confirmDelete(eventId: string): void {
  const pending = pendingMap.get(eventId);
  if (!pending) return;

  pendingMap.delete(eventId);
  fireDeleteApi(pending.event);
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
    revalidateWeeksForDates(event.start, patch.start ?? event.start);
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
