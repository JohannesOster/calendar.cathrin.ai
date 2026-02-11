import { createSignal } from "solid-js";
import { apiFetch } from "../lib/api";
import { getWeekId, getWeekBounds, getWeeksInRange } from "../lib/date-utils";
import type { CalendarEvent, EventPatch } from "./event-types";

// =============================================================================
// Signals
// =============================================================================
export const [events, setEvents] = createSignal<CalendarEvent[]>([]);
export const [isLoading, setIsLoading] = createSignal(false);
export const [lastRefreshed, setLastRefreshed] = createSignal<Date | null>(null);
export const [eventsError, setEventsError] = createSignal<string | null>(null);
export const [fetchedWeeks, setFetchedWeeks] = createSignal<Set<string>>(new Set());

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

/** Getter for event-fetching.ts to access pending deletion map. */
export function getPendingDeletionMap(): Map<string, unknown> {
  return _pendingDeletionMap;
}

/** Getter for event-fetching.ts to access revalidation function. */
export function getRevalidateWeeksForDates(): ((...dates: Date[]) => void) | null {
  return _revalidateWeeksForDates;
}

/** Getter for event-fetching.ts to access visible weeks setter. */
export function getSetVisibleWeeksForPolling(): ((weeks: Set<string>) => void) | null {
  return _setVisibleWeeksForPolling;
}

// =============================================================================
// Helpers
// =============================================================================

function formatDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// =============================================================================
// Optimistic Local Events
// =============================================================================

/**
 * Add an event locally (optimistic UI).
 * Used for newly created events before server confirmation.
 */
export function addLocalEvent(event: CalendarEvent): void {
  setEvents((prev) => {
    const uniqueEvents = new Map<string, CalendarEvent>();
    for (const e of prev) {
      uniqueEvents.set(e.id, e);
    }
    uniqueEvents.set(event.id, event);
    return Array.from(uniqueEvents.values()).sort(
      (a, b) => a.start.getTime() - b.start.getTime()
    );
  });
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

/**
 * Update an event optimistically: apply patch locally, then PATCH API.
 * On failure, rollback to the snapshot.
 *
 * When the caller has already mutated the events signal before calling this
 * (e.g. live drag preview), pass the true original values via `rollback`
 * so the snapshot captures the correct pre-mutation state.
 */
export async function updateEvent(
  eventId: string,
  patch: EventPatch,
  rollback?: EventPatch,
): Promise<void> {
  const event = events().find((e) => e.id === eventId);
  if (!event) return;

  // Snapshot for rollback — merge in any explicit rollback values so the
  // snapshot reflects the true pre-mutation state even when the caller
  // pre-mutated the signal (e.g. during drag).
  const snapshot: CalendarEvent = {
    ...event,
    ...(rollback?.title !== undefined && { title: rollback.title }),
    ...(rollback?.description !== undefined && { description: rollback.description }),
    ...(rollback?.location !== undefined && { location: rollback.location }),
    ...(rollback?.start !== undefined && { start: rollback.start }),
    ...(rollback?.end !== undefined && { end: rollback.end }),
    ...(rollback?.isAllDay !== undefined && { isAllDay: rollback.isAllDay }),
  };

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
  const isAllDay = patch.isAllDay ?? event.isAllDay;
  if (patch.start !== undefined) {
    apiPatch.start = isAllDay
      ? formatDateOnly(patch.start)
      : patch.start.toISOString();
  }
  if (patch.end !== undefined) {
    apiPatch.end = isAllDay
      ? formatDateOnly(patch.end)
      : patch.end.toISOString();
  }

  try {
    await apiFetch(`/api/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      body: JSON.stringify(apiPatch),
    });
    _revalidateWeeksForDates?.(snapshot.start, patch.start ?? snapshot.start);
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
