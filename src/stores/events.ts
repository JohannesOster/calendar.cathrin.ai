import { createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { connectedAccounts } from "./accounts";
import { getWeekId, getWeekBounds, getWeeksInRange } from "../lib/date-utils";

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
    // If no window was provided (initial load/refresh), we might want to replace everything?
    // But for safety and simplicity, merging is usually properly safe if we trust deduplication.
    // However, if we do a full refresh (no window), we probably expect to clear stale events that might have been deleted?
    // For now, let's assume 'processEvents' handles merging.
    // If window is NOT provided, it effectively acts as a "reset" or "initial load" logic in original code.
    // To support "replace all", we would pass empty array to processEvents second arg.
    
    // If window IS provided, we merge.
    // If window IS NOT provided (refresh button or init), we probably want to keep existing events that are OUTSIDE the default window?
    // Or maybe we want to reset? The original code replaced EVERYTHING.
    // Let's preserve original behavior: if no window, replace everything (implied by passing empty array as existing).
    // actually, let's keep all events to be safe, so we don't lose scrolled-to events.
    
    setEvents((prev) => processEvents(newEvents, window ? prev : []));
    
    setLastRefreshed(new Date());
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
 * Fetch events for a specific week (for all accounts)
 * Merges into existing cache rather than replacing
 */
export async function fetchEventsForWeek(weekId: string): Promise<void> {
  const accounts = connectedAccounts();
  if (accounts.length === 0) return;

  const { start, end } = getWeekBounds(weekId);
  const timeMin = start.toISOString();
  const timeMax = end.toISOString();

  const newEvents: CalendarEvent[] = [];

  for (const account of accounts) {
    try {
      const accountEvents = await invoke<StoredEvent[]>("fetch_events_for_week", {
        accountId: account.id,
        weekId,
        timeMin,
        timeMax,
      });

      newEvents.push(...accountEvents.map(convertToCalendarEvent));
    } catch (error) {
      console.error(`Failed to fetch week ${weekId} for account ${account.id}:`, error);
    }
  }

  // Merge new events with existing
  setEvents((prev) => processEvents(newEvents, prev));

  // Update local fetched weeks tracker
  setFetchedWeeks((prev) => {
    const updated = new Set(prev);
    updated.add(weekId);
    return updated;
  });
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
