import { createSignal } from "solid-js";
import { apiFetch, ApiError } from "../lib/api";
import { showErrorToast } from "../lib/toast";
import { getWeekId, getWeekBounds, getWeeksInRange } from "../lib/date-utils";
import type { CalendarEvent, EventPatch } from "./event-types";
import { cathrinKeyToGoogleColorId } from "../lib/color-mapping";
import { RRULE_REVALIDATE_FIRST_MS, RRULE_REVALIDATE_SECOND_MS } from "../constants/calendar";
import { expandRRule } from "../utils/rrule-expand";
import { formatDateOnly } from "../utils/date-format";
import { markSeriesDirty, markServerConfirmed, clearDirty } from "./event-dirty";
import { centerDate } from "./calendar-navigation";

// =============================================================================
// Per-series mutation lock
// =============================================================================

const seriesLocks = new Map<string, Promise<void>>();

async function withSeriesLock(seriesId: string, fn: () => Promise<void>): Promise<void> {
  const existing = seriesLocks.get(seriesId);
  const chained = (existing ?? Promise.resolve()).then(fn, fn);
  seriesLocks.set(seriesId, chained);
  chained.finally(() => {
    if (seriesLocks.get(seriesId) === chained) seriesLocks.delete(seriesId);
  });
  return chained;
}

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
 * Apply RRULE re-expansion: remove old siblings, update primary event,
 * and expand new instances from the changed recurrence rule.
 * Returns IDs of the newly created temp instances (for rollback).
 */
function applyRecurrenceReExpansion(
  eventId: string,
  event: CalendarEvent,
  patch: EventPatch,
  snapshot: CalendarEvent,
  masterId: string,
  scope: "single" | "all" | "following" | undefined,
  siblingSnapshots: CalendarEvent[],
): string[] {
  const addedTempIds: string[] = [];
  const siblingIds = new Set(siblingSnapshots.map((e) => e.id));

  // Update the primary event + remove affected siblings
  setEvents((prev) => {
    const filtered = prev.filter((e) => !siblingIds.has(e.id));
    return filtered.map((e) =>
      e.id === eventId
        ? {
            ...e,
            ...(patch.title !== undefined && { title: patch.title }),
            ...(patch.recurrence !== undefined && { recurrence: patch.recurrence ?? undefined }),
            // When removing recurrence, clear the instance link so the event
            // appears as a standalone event in the UI (no "Repeats" label).
            ...(patch.recurrence === null && e.recurringEventId && { recurringEventId: undefined }),
          }
        : e
    );
  });

  // Re-expand new RRULE if recurrence is being set (not removed)
  if (patch.recurrence && patch.recurrence.length > 0) {
    try {
      const dtstart = patch.start ?? snapshot.start;
      const durationMs = (patch.end ?? snapshot.end).getTime() - dtstart.getTime();
      const instances = expandRRule(patch.recurrence, dtstart, durationMs, centerDate());

      const newEvents: CalendarEvent[] = [];
      for (const inst of instances) {
        if (scope === "following" && inst.start.getTime() < snapshot.start.getTime()) continue;

        const dateISO = inst.start.toISOString().slice(0, 10);
        const tempInstanceId = `${eventId}-rrule-${dateISO}`;
        addedTempIds.push(tempInstanceId);
        newEvents.push({
          ...event,
          id: tempInstanceId,
          providerEventId: "",
          start: inst.start,
          end: inst.end,
          recurringEventId: masterId,
          recurrence: undefined,
          rruleExpandedAt: Date.now(),
          ...(patch.title !== undefined && { title: patch.title }),
        });
      }

      if (newEvents.length > 0) {
        setEvents((prev) => [...prev, ...newEvents]);
      }
    } catch (err) {
      console.warn("[events] Failed to re-expand RRULE:", err);
    }
  }

  return addedTempIds;
}

/**
 * Rollback an optimistic update: restore primary event + siblings,
 * remove any temp RRULE instances that were added.
 */
function rollbackOptimisticUpdate(
  eventId: string,
  snapshot: CalendarEvent,
  siblingSnapshots: CalendarEvent[],
  addedTempIds: string[],
): void {
  const tempIdSet = new Set(addedTempIds);
  const snapshotMap = new Map<string, CalendarEvent>();
  snapshotMap.set(eventId, snapshot);
  for (const s of siblingSnapshots) {
    snapshotMap.set(s.id, s);
  }
  setEvents((prev) => {
    const filtered = tempIdSet.size > 0 ? prev.filter((e) => !tempIdSet.has(e.id)) : prev;
    const restored = filtered.map((e) => snapshotMap.get(e.id) ?? e);
    const restoredIds = new Set(restored.map((e) => e.id));
    const missingSnapshots = siblingSnapshots.filter((s) => !restoredIds.has(s.id));
    return missingSnapshots.length > 0 ? [...restored, ...missingSnapshots] : restored;
  });
}

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
  scope?: "single" | "all" | "following",
  sendUpdates?: "all" | "none",
): Promise<void> {
  const event = events().find((e) => e.id === eventId);
  if (!event) return;

  const masterId = event.recurringEventId || event.providerEventId;
  return withSeriesLock(masterId, async () => {
  // Re-read event inside lock — it may have changed while queued
  const lockedEvent = events().find((e) => e.id === eventId);
  if (!lockedEvent) return;

  // Snapshot for rollback — merge in any explicit rollback values so the
  // snapshot reflects the true pre-mutation state even when the caller
  // pre-mutated the signal (e.g. during drag).
  const event = lockedEvent;
  const snapshot: CalendarEvent = {
    ...event,
    ...(rollback?.title !== undefined && { title: rollback.title }),
    ...(rollback?.description !== undefined && { description: rollback.description }),
    ...(rollback?.location !== undefined && { location: rollback.location }),
    ...(rollback?.start !== undefined && { start: rollback.start }),
    ...(rollback?.end !== undefined && { end: rollback.end }),
    ...(rollback?.isAllDay !== undefined && { isAllDay: rollback.isAllDay }),
    ...(rollback?.transparency !== undefined && { transparency: rollback.transparency }),
    ...(rollback?.visibility !== undefined && { visibility: rollback.visibility }),
    ...(rollback?.reminders !== undefined && { reminders: rollback.reminders }),
    ...(rollback?.colorId !== undefined && { colorId: rollback.colorId }),
    ...(rollback?.conferencing !== undefined && { conferencing: rollback.conferencing }),
    ...(rollback?.timeZone !== undefined && { timeZone: rollback.timeZone }),
    ...(rollback?.attendees !== undefined && { attendees: rollback.attendees ?? undefined }),
    ...(rollback?.recurrence !== undefined && { recurrence: rollback.recurrence ?? undefined }),
  };

  // Identify sibling events for series-wide optimistic updates
  const isSeries = scope === "all" || scope === "following";

  // Compute time deltas for sibling patching (preserve each sibling's own time)
  const startDeltaMs = patch.start ? patch.start.getTime() - snapshot.start.getTime() : 0;
  const endDeltaMs = patch.end ? patch.end.getTime() - snapshot.end.getTime() : 0;

  // Build the non-time fields to spread onto siblings
  const siblingFieldPatch = {
    ...(patch.title !== undefined && { title: patch.title }),
    ...(patch.description !== undefined && { description: patch.description }),
    ...(patch.location !== undefined && { location: patch.location }),
    ...(patch.isAllDay !== undefined && { isAllDay: patch.isAllDay }),
    ...(patch.transparency !== undefined && { transparency: patch.transparency }),
    ...(patch.visibility !== undefined && { visibility: patch.visibility }),
    ...(patch.colorId !== undefined && { colorId: patch.colorId ?? undefined }),
  };

  // Snapshot all affected siblings for rollback
  let siblingSnapshots: CalendarEvent[] = [];
  if (isSeries) {
    const allEvts = events();
    siblingSnapshots = allEvts.filter((e) => {
      if (e.id === eventId) return false; // primary event handled by main snapshot
      // Only match siblings on the same calendar to avoid cross-account false positives
      if (e.calendarId !== event.calendarId) return false;
      const isSibling = e.recurringEventId === masterId || e.providerEventId === masterId;
      if (!isSibling) return false;
      if (scope === "following") {
        return new Date(e.start).getTime() >= snapshot.start.getTime();
      }
      return true;
    }).map((e) => ({ ...e }));
  }

  // RRULE re-expansion: when recurrence changes (or is added to a standalone event),
  // remove old siblings and expand new instances
  const isAddingRecurrence = patch.recurrence !== undefined && patch.recurrence.length > 0 && !event.recurrence && !event.recurringEventId;
  const isRecurrenceChange = (patch.recurrence !== undefined && isSeries) || isAddingRecurrence;
  const addedTempIds: string[] = [];

  if (isRecurrenceChange) {
    addedTempIds.push(
      ...applyRecurrenceReExpansion(eventId, event, patch, snapshot, masterId, scope, siblingSnapshots)
    );
    if (patch.recurrence && patch.recurrence.length > 0) {
      markSeriesDirty(masterId, addedTempIds, patch.recurrence);
    }
  } else {
    // Apply optimistic update (non-recurrence changes)
    setEvents((prev) =>
      prev.map((e) => {
        // Primary event: apply the full patch directly
        if (e.id === eventId) {
          return {
            ...e,
            ...(patch.title !== undefined && { title: patch.title }),
            ...(patch.description !== undefined && { description: patch.description }),
            ...(patch.location !== undefined && { location: patch.location }),
            ...(patch.start !== undefined && { start: patch.start }),
            ...(patch.end !== undefined && { end: patch.end }),
            ...(patch.isAllDay !== undefined && { isAllDay: patch.isAllDay }),
            ...(patch.transparency !== undefined && { transparency: patch.transparency }),
            ...(patch.visibility !== undefined && { visibility: patch.visibility }),
            ...(patch.reminders !== undefined && { reminders: patch.reminders ?? undefined }),
            ...(patch.colorId !== undefined && { colorId: patch.colorId ?? undefined }),
            ...(patch.conferencing !== undefined && { conferencing: patch.conferencing }),
            ...(patch.timeZone !== undefined && { timeZone: patch.timeZone }),
            ...(patch.attendees !== undefined && { attendees: patch.attendees ?? undefined }),
            ...(patch.recurrence !== undefined && { recurrence: patch.recurrence ?? undefined }),
          };
        }

        // Sibling events: apply series-wide fields + time deltas
        if (isSeries && e.calendarId === event.calendarId) {
          const isSibling = e.recurringEventId === masterId || e.providerEventId === masterId;
          if (isSibling) {
            if (scope === "following" && new Date(e.start).getTime() < snapshot.start.getTime()) {
              return e; // past sibling — don't touch
            }
            return {
              ...e,
              ...siblingFieldPatch,
              ...(startDeltaMs !== 0 && { start: new Date(e.start.getTime() + startDeltaMs) }),
              ...(endDeltaMs !== 0 && { end: new Date(e.end.getTime() + endDeltaMs) }),
            };
          }
        }

        return e;
      })
    );
  }

  // Build API patch body
  const apiPatch: Record<string, string | boolean> = {};
  if (patch.title !== undefined) apiPatch.summary = patch.title;
  if (patch.description !== undefined) apiPatch.description = patch.description;
  if (patch.location !== undefined) apiPatch.location = patch.location;
  if (patch.isAllDay !== undefined) apiPatch.isAllDay = patch.isAllDay;
  if (patch.transparency !== undefined) apiPatch.transparency = patch.transparency;
  if (patch.visibility !== undefined) apiPatch.visibility = patch.visibility;
  if (patch.reminders !== undefined) (apiPatch as Record<string, unknown>).reminders = patch.reminders;
  if (patch.colorId !== undefined) {
    (apiPatch as Record<string, unknown>).colorId = patch.colorId ? cathrinKeyToGoogleColorId(patch.colorId) : null;
  }
  if (patch.conferencing !== undefined) {
    if (patch.conferencing === null) {
      (apiPatch as Record<string, unknown>).conferencing = null;
    } else if (patch.conferencing.uri) {
      (apiPatch as Record<string, unknown>).conferencing = { type: "manual", uri: patch.conferencing.uri };
    }
  }
  if (patch.timeZone !== undefined) (apiPatch as Record<string, unknown>).timeZone = patch.timeZone;
  if (patch.attendees !== undefined) {
    (apiPatch as Record<string, unknown>).attendees = patch.attendees
      ? patch.attendees.map(a => ({ email: a.email, name: a.name }))
      : null;
  }
  if (patch.recurrence !== undefined) {
    (apiPatch as Record<string, unknown>).recurrence = patch.recurrence;
  }
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

  const params = new URLSearchParams({ calendarId: event.calendarId });
  if (scope) params.set("scope", scope);

  // Include sendUpdates in the body (not query param) for the PATCH
  if (sendUpdates) (apiPatch as Record<string, unknown>).sendUpdates = sendUpdates;

  try {
    await apiFetch(`/api/events/${encodeURIComponent(event.providerEventId)}?${params.toString()}`, {
      method: "PATCH",
      body: JSON.stringify(apiPatch),
    });
    // After recurrence changes, mark server confirmed and delay revalidation
    // to let the provider propagate the RRULE mutation before we re-fetch.
    if (isRecurrenceChange) {
      markServerConfirmed(masterId);
      const dates = [snapshot.start, patch.start ?? snapshot.start];
      // First revalidation: server may still return stale instances, but the
      // dirty-flag system keeps optimistic instances alive until the server
      // returns matching recurrence. Second revalidation catches slower providers.
      setTimeout(() => _revalidateWeeksForDates?.(...dates), RRULE_REVALIDATE_FIRST_MS);
      setTimeout(() => _revalidateWeeksForDates?.(...dates), RRULE_REVALIDATE_SECOND_MS);
    } else {
      const datesToRevalidate = [snapshot.start, patch.start ?? snapshot.start];
      for (const s of siblingSnapshots) {
        datesToRevalidate.push(s.start);
      }
      _revalidateWeeksForDates?.(...datesToRevalidate);
    }
  } catch (error) {
    console.error(`[events] Failed to update event ${eventId}:`, error);
    rollbackOptimisticUpdate(eventId, snapshot, siblingSnapshots, addedTempIds);
    if (isRecurrenceChange) {
      clearDirty(masterId);
    }
    if (error instanceof ApiError && error.status === 403) {
      showErrorToast("Permission denied", "You don't have permission to modify this calendar");
    }
  }
  }); // withSeriesLock
}

// =============================================================================
// Move Event (Calendar Reassignment)
// =============================================================================

/**
 * Move an event to a different calendar. Optimistic update with rollback.
 * Uses a dedicated /move endpoint, not the PATCH path.
 */
export async function moveEvent(
  eventId: string,
  targetCalendarId: string,
  targetCalendarColor: string,
): Promise<void> {
  const event = events().find((e) => e.id === eventId);
  if (!event) return;

  const originalCalendarId = event.calendarId;
  const originalColor = event.color;

  // Optimistic update — only change color if no per-event override
  const newColor = event.colorId ? event.color : targetCalendarColor;
  setEvents((prev) =>
    prev.map((e) =>
      e.id === eventId
        ? { ...e, calendarId: targetCalendarId, color: newColor }
        : e
    )
  );

  try {
    await apiFetch(`/api/events/${encodeURIComponent(event.providerEventId)}/move?calendarId=${encodeURIComponent(event.calendarId)}`, {
      method: "POST",
      body: JSON.stringify({ targetCalendarId }),
    });
    _revalidateWeeksForDates?.(event.start);
  } catch (error) {
    console.error(`[events] Failed to move event ${eventId}:`, error);
    // Rollback
    setEvents((prev) =>
      prev.map((e) =>
        e.id === eventId
          ? { ...e, calendarId: originalCalendarId, color: originalColor }
          : e
      )
    );
    if (error instanceof ApiError && error.status === 403) {
      showErrorToast("Permission denied", "You don't have permission to modify this calendar");
    }
    throw error;
  }
}

// Re-export week utilities for convenience
export { getWeekId, getWeekBounds, getWeeksInRange };
