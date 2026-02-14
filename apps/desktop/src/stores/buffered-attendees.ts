import { createSignal } from "solid-js";
import type { Attendee } from "@cathrin/shared-types";

/**
 * In-memory buffer tracking original attendees for events with unsaved
 * attendee changes. When a user adds/removes attendees in edit mode,
 * the original list is captured here so we can detect net-zero changes
 * and revert on discard.
 *
 * Not persisted to localStorage — if the app restarts, buffered changes
 * are lost. Navigate-away auto-saves with sendUpdates: "none" and adds
 * a pending notification, so the user can decide about emails later.
 */
const [bufferedMap, setBufferedMap] = createSignal<Map<string, Attendee[]>>(new Map());

/** Capture original attendees before the first local edit. No-op if already buffering. */
export function startBuffering(eventId: string, originalAttendees: Attendee[]): void {
  setBufferedMap(prev => {
    if (prev.has(eventId)) return prev;
    const next = new Map(prev);
    next.set(eventId, [...originalAttendees]);
    return next;
  });
}

/** Whether this event has buffered (unsaved) attendee changes. */
export function isBuffered(eventId: string): boolean {
  return bufferedMap().has(eventId);
}

/** Get the original attendees captured before local edits. */
export function getOriginalAttendees(eventId: string): Attendee[] | undefined {
  return bufferedMap().get(eventId);
}

/** Clear the buffer for an event (after save, discard, or navigate-away). */
export function clearBuffer(eventId: string): void {
  setBufferedMap(prev => {
    if (!prev.has(eventId)) return prev;
    const next = new Map(prev);
    next.delete(eventId);
    return next;
  });
}
