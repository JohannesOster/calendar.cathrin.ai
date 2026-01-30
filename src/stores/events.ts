import { createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { connectedAccounts } from "./accounts";
import { getWeekId, getWeekBounds, getWeeksInRange, addDays } from "../lib/date-utils";

/**
 * Event data from the backend, with dates parsed to JS Date objects
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

/**
 * Raw event data from Tauri backend (dates as strings)
 */
interface StoredEvent {
  id: string;
  calendar_id: string;
  title: string;
  start: string;
  end: string;
  is_all_day: boolean;
  color: string;
}

/**
 * Cached events structure from Tauri backend
 */
interface EventCache {
  events: StoredEvent[];
  last_fetched_at: number;
  fetched_weeks: string[];  // ISO week format: "YYYY-Wnn"
}

// Time window for fetching events (days relative to now)
const DAYS_BEFORE = 7;
const DAYS_AFTER = 30;

// Pruning window: keep events within ±90 days of center date
const PRUNE_WINDOW_DAYS = 90;

// Signals for events state
export const [events, setEvents] = createSignal<CalendarEvent[]>([]);
export const [isLoading, setIsLoading] = createSignal(false);
export const [lastRefreshed, setLastRefreshed] = createSignal<Date | null>(
  null
);
export const [eventsError, setEventsError] = createSignal<string | null>(null);

/**
 * Track which weeks have been fetched (across all accounts)
 * This is a local cache of the union of all accounts' fetched_weeks
 */
const [fetchedWeeks, setFetchedWeeks] = createSignal<Set<string>>(new Set());

/**
 * Track which weeks are currently being fetched (in-flight requests)
 * Prevents duplicate fetches for the same week
 */
const [fetchingWeeks, setFetchingWeeks] = createSignal<Set<string>>(new Set());

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
 * Convert backend StoredEvent to frontend CalendarEvent
 */
function convertToCalendarEvent(event: StoredEvent): CalendarEvent {
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
function processEvents(newEvents: CalendarEvent[], existingEvents: CalendarEvent[] = []): CalendarEvent[] {
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
    (a, b) => a.start.getTime() - b.start.getTime()
  );
}

/**
 * Prune events outside a time window around the center date
 * Keeps events that overlap with the window (multi-day events spanning boundary are kept)
 */
function pruneEvents(events: CalendarEvent[], centerDate: Date): CalendarEvent[] {
  const minTime = addDays(centerDate, -PRUNE_WINDOW_DAYS).getTime();
  const maxTime = addDays(centerDate, PRUNE_WINDOW_DAYS).getTime();

  return events.filter((event) => {
    // Keep event if any part of it overlaps with the prune window
    // Event overlaps if it starts before window ends AND ends after window starts
    const eventStart = event.start.getTime();
    const eventEnd = event.end.getTime();
    return eventStart <= maxTime && eventEnd >= minTime;
  });
}

/**
 * Prune fetched weeks outside the prune window
 * This ensures scrolling back to pruned weeks will trigger re-fetch
 */
function pruneFetchedWeeks(weeks: Set<string>, centerDate: Date): Set<string> {
  const minDate = addDays(centerDate, -PRUNE_WINDOW_DAYS);
  const maxDate = addDays(centerDate, PRUNE_WINDOW_DAYS);

  const prunedWeeks = new Set<string>();
  for (const weekId of weeks) {
    const { start, end } = getWeekBounds(weekId);
    // Keep week if any part of it overlaps with prune window
    if (start.getTime() <= maxDate.getTime() && end.getTime() >= minDate.getTime()) {
      prunedWeeks.add(weekId);
    }
  }
  return prunedWeeks;
}

/**
 * Load events from cache (fast, no network)
 * Silently fails if no cache exists - empty state is fine
 * Also syncs the fetched weeks tracker
 */
export async function loadCachedEvents(): Promise<void> {
  try {
    const accounts = connectedAccounts();
    if (accounts.length === 0) {
      setEvents([]);
      setFetchedWeeks(new Set());
      return;
    }

    const allEvents: CalendarEvent[] = [];
    const allWeeks = new Set<string>();

    for (const account of accounts) {
      const cache = await invoke<EventCache | null>("get_cached_events", {
        accountId: account.id,
      });

      if (cache?.events) {
        allEvents.push(...cache.events.map(convertToCalendarEvent));
      }

      if (cache?.fetched_weeks) {
        for (const week of cache.fetched_weeks) {
          allWeeks.add(week);
        }
      }
    }

    setEvents(processEvents(allEvents));
    setFetchedWeeks(allWeeks);
  } catch {
    setEvents([]);
    setFetchedWeeks(new Set());
  }
}

/**
 * Refresh events from Google Calendar API
 * Shows loading state and surfaces errors
 * @param window Optional time window to fetch events for. Defaults to initial window.
 */
export async function refreshEvents(window?: { start: Date; end: Date }): Promise<void> {
  // Only set global loading on initial fetch or full refresh
  if (!window) {
    setIsLoading(true);
  }
  setEventsError(null);

  try {
    const accounts = connectedAccounts();
    if (accounts.length === 0) {
      setEvents([]);
      setLastRefreshed(new Date());
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

    const newEvents: CalendarEvent[] = [];

    for (const account of accounts) {
      const accountEvents = await invoke<StoredEvent[]>("fetch_events", {
        accountId: account.id,
        timeMin,
        timeMax,
      });

      newEvents.push(...accountEvents.map(convertToCalendarEvent));
    }

    // Merge new events with existing ones
    // If window IS provided, merge with existing and prune to prevent unbounded growth.
    // If window IS NOT provided (full refresh), replace entirely (no pruning needed).
    const now = new Date();
    if (window) {
      setEvents((prev) => {
        const merged = processEvents(newEvents, prev);
        return pruneEvents(merged, now);
      });
      // Also prune fetched weeks tracker
      setFetchedWeeks((prev) => pruneFetchedWeeks(prev, now));
    } else {
      setEvents(processEvents(newEvents, []));
    }

    setLastRefreshed(now);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    setEventsError(errorMessage || "Failed to refresh events");
  } finally {
    setIsLoading(false);
  }
}

/**
 * Initialize events: load from cache, then refresh in background
 * Call this on app startup after accounts are initialized
 */
export async function initializeEvents(): Promise<void> {
  await loadCachedEvents();
  // Refresh in background (no await) - stale-while-revalidate pattern
  refreshEvents();
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
 * Fetch events for a specific week (for all accounts)
 * Merges into existing cache rather than replacing
 * Tracks in-flight state to prevent duplicate requests
 * Supports cancellation via request ID pattern
 */
export async function fetchEventsForWeek(weekId: string): Promise<void> {
  // Skip if already fetching this week
  if (fetchingWeeks().has(weekId)) {
    console.log(`[events] Skipping ${weekId} - already fetching`);
    return;
  }

  // Skip if already fetched
  if (fetchedWeeks().has(weekId)) {
    console.log(`[events] Skipping ${weekId} - already cached`);
    return;
  }

  const accounts = connectedAccounts();
  if (accounts.length === 0) return;

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

    const newEvents: CalendarEvent[] = [];

    for (const account of accounts) {
      // Check if request was cancelled before each account fetch
      if (requestId !== currentRequestId) {
        console.log(`[events] Discarding stale fetch for ${weekId} (cancelled during fetch)`);
        return;
      }

      try {
        const accountEvents = await invoke<StoredEvent[]>("fetch_events_for_week", {
          accountId: account.id,
          weekId,
          timeMin,
          timeMax,
        });

        newEvents.push(...accountEvents.map(convertToCalendarEvent));
      } catch (error) {
        console.error(`[events] Failed to fetch week ${weekId} for account ${account.id}:`, error);
      }
    }

    // Check if this request is still relevant before updating state
    if (requestId !== currentRequestId) {
      console.log(`[events] Discarding stale fetch for ${weekId} (cancelled after fetch)`);
      return;
    }

    // Merge new events with existing and prune old events
    const now = new Date();
    setEvents((prev) => {
      const merged = processEvents(newEvents, prev);
      return pruneEvents(merged, now);
    });

    // Update local fetched weeks tracker and prune old weeks
    setFetchedWeeks((prev) => {
      const updated = new Set(prev);
      updated.add(weekId);
      return pruneFetchedWeeks(updated, now);
    });

    console.log(`[events] Fetched ${weekId} - ${newEvents.length} events`);
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
  end: Date
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
 * Update the fetched weeks tracker from cache data
 * Call this after loading from cache to sync the local state
 */
export async function syncFetchedWeeksFromCache(): Promise<void> {
  const accounts = connectedAccounts();
  const allWeeks = new Set<string>();

  for (const account of accounts) {
    try {
      const cache = await invoke<EventCache | null>("get_cached_events", {
        accountId: account.id,
      });

      if (cache?.fetched_weeks) {
        for (const week of cache.fetched_weeks) {
          allWeeks.add(week);
        }
      }
    } catch {
      // Ignore cache read errors
    }
  }

  setFetchedWeeks(allWeeks);
}

// Re-export week utilities for convenience
export { getWeekId, getWeekBounds, getWeeksInRange };
