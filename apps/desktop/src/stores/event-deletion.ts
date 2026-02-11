import { apiFetch } from "../lib/api";
import {
  deleteCachedEventFromDisk,
  restoreCachedEventToDisk,
} from "../lib/event-cache";
import {
  events,
  addLocalEvent,
  removeLocalEvent,
  _registerPendingMap,
} from "./events";
import type { CalendarEvent } from "./event-types";
import { revalidateWeeksForDates } from "./event-polling";

// =============================================================================
// Types
// =============================================================================

export interface PendingDeletion {
  event: CalendarEvent;
}

// =============================================================================
// State
// =============================================================================

/**
 * Non-reactive map of pending deletions. The toast component subscribes
 * to the `onDeletion` callback to manage its own rendering lifecycle,
 * which prevents store/signal array mutations from recreating sibling toasts.
 */
export const pendingMap = new Map<string, PendingDeletion>();

// Register with events.ts so processEvents/replaceEventsInRange can filter
// out pending deletions without importing this module (avoiding circular deps).
_registerPendingMap(pendingMap);

type DeletionListener = (deletion: PendingDeletion) => void;
const listeners = new Set<DeletionListener>();

// =============================================================================
// Subscription
// =============================================================================

/** Subscribe to new deletion events (used by UndoToast). */
export function onDeletion(fn: DeletionListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// =============================================================================
// Actions
// =============================================================================

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
  if (event.isReadOnly) return;

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
