import { createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { connectedAccounts } from "./accounts";

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
  window_start: string;
  window_end: string;
}

// Signals for events state
export const [events, setEvents] = createSignal<CalendarEvent[]>([]);
export const [isLoading, setIsLoading] = createSignal(false);
export const [lastRefreshed, setLastRefreshed] = createSignal<Date | null>(
  null
);
export const [eventsError, setEventsError] = createSignal<string | null>(null);

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
 * Default: -7 days to +30 days from now
 */
function getTimeWindow(): { timeMin: string; timeMax: string } {
  const now = new Date();

  const min = new Date(now);
  min.setDate(min.getDate() - 7);
  min.setHours(0, 0, 0, 0);

  const max = new Date(now);
  max.setDate(max.getDate() + 30);
  max.setHours(23, 59, 59, 999);

  return {
    timeMin: min.toISOString(),
    timeMax: max.toISOString(),
  };
}

/**
 * Deduplicate and sort events by start time
 */
function processEvents(allEvents: CalendarEvent[]): CalendarEvent[] {
  // Deduplicate by event id
  const uniqueEvents = new Map<string, CalendarEvent>();
  for (const event of allEvents) {
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
 */
export async function loadCachedEvents(): Promise<void> {
  try {
    const accounts = connectedAccounts();
    if (accounts.length === 0) {
      setEvents([]);
      return;
    }

    const allEvents: CalendarEvent[] = [];

    for (const account of accounts) {
      const cache = await invoke<EventCache | null>("get_cached_events", {
        accountId: account.id,
      });

      if (cache?.events) {
        allEvents.push(...cache.events.map(convertToCalendarEvent));
      }
    }

    setEvents(processEvents(allEvents));
  } catch {
    setEvents([]);
  }
}

/**
 * Refresh events from Google Calendar API
 * Shows loading state and surfaces errors
 */
export async function refreshEvents(): Promise<void> {
  setIsLoading(true);
  setEventsError(null);

  try {
    const accounts = connectedAccounts();
    if (accounts.length === 0) {
      setEvents([]);
      setLastRefreshed(new Date());
      return;
    }

    const { timeMin, timeMax } = getTimeWindow();
    const allEvents: CalendarEvent[] = [];

    for (const account of accounts) {
      const accountEvents = await invoke<StoredEvent[]>("fetch_events", {
        accountId: account.id,
        timeMin,
        timeMax,
      });

      allEvents.push(...accountEvents.map(convertToCalendarEvent));
    }

    setEvents(processEvents(allEvents));
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
