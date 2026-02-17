import { apiFetch } from "../lib/api";
import { isAuthenticated } from "./auth";
import { getWeekId, getWeekBounds } from "../lib/date-utils";
import {
  recordWeekAccess,
  recordWeekFetch,
  STALE_THRESHOLD_MS,
} from "../lib/event-cache";
import {
  setEvents,
  fetchedWeeks,
  _registerPollingFns,
} from "./events";
import { getStaleWeeks, replaceEventsInRange } from "./event-fetching";
import { convertApiEvent } from "./event-types";
import { onWsWeeksChanged } from "../services/websocket";
import type { ApiCalendarEvent } from "@cathrin/shared-types";

// =============================================================================
// Configuration
// =============================================================================

// Polling interval matches staleness threshold for responsive updates
const POLL_INTERVAL_MS = STALE_THRESHOLD_MS;

// =============================================================================
// State
// =============================================================================

let currentVisibleWeeks: Set<string> = new Set();
let pollIntervalId: ReturnType<typeof setInterval> | null = null;
const revalidatingWeeks = new Set<string>();
const pendingRevalidation = new Set<string>();

// =============================================================================
// Revalidation
// =============================================================================

async function revalidateWeekBackground(weekId: string): Promise<void> {
  if (revalidatingWeeks.has(weekId)) {
    pendingRevalidation.add(weekId);
    console.log(`[events] Queued revalidation for ${weekId} - already in progress`);
    return;
  }

  revalidatingWeeks.add(weekId);
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
    revalidatingWeeks.delete(weekId);
    if (pendingRevalidation.has(weekId)) {
      pendingRevalidation.delete(weekId);
      revalidateWeekBackground(weekId).catch((err) =>
        console.warn(`[events] Queued revalidation failed for ${weekId}:`, err)
      );
    }
  }
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
    // Revalidate regardless of whether the week is in fetchedWeeks —
    // a cross-week move might target an unfetched week that needs fetching.
    revalidateWeekBackground(weekId);
  }
}

/**
 * Update the set of currently visible weeks for polling.
 * Called from events.ts when the visible week range changes.
 */
export function setVisibleWeeksForPolling(weeks: Set<string>): void {
  currentVisibleWeeks = weeks;
}

// Register with events.ts so it can call our functions without importing us
// (breaking the circular dependency: event-polling -> events -> event-polling).
_registerPollingFns({
  revalidateWeeksForDates,
  setVisibleWeeksForPolling,
});

// Register WebSocket handler — immediately fetch affected weeks when server pushes changes
onWsWeeksChanged((weekIds) => {
  if (!isAuthenticated()) return;
  console.log(`[events] WebSocket: fetching ${weekIds.length} changed weeks`);
  for (const weekId of weekIds) {
    revalidateWeekBackground(weekId);
  }
});
