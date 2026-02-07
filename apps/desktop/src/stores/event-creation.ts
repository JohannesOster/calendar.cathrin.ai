import { createSignal } from "solid-js";
import { defaultCalendarId, connectedAccounts } from "./accounts";
import { SNAP_MINUTES } from "../constants/calendar";

// =============================================================================
// Signals
// =============================================================================
export const [isCreating, setIsCreating] = createSignal(false);
export const [isDragging, setIsDragging] = createSignal(false);
export const [draftStart, setDraftStart] = createSignal<Date | null>(null);
export const [draftEnd, setDraftEnd] = createSignal<Date | null>(null);
export const [draftTitle, setDraftTitle] = createSignal("");
export const [draftCalendarId, setDraftCalendarId] = createSignal<string | null>(null);

// =============================================================================
// Helpers
// =============================================================================

/**
 * Snap a total-minutes value to the nearest SNAP_MINUTES increment
 */
export function snapMinutes(totalMinutes: number): number {
  return Math.round(totalMinutes / SNAP_MINUTES) * SNAP_MINUTES;
}

/**
 * Get the calendar color for the current draft event
 */
export function getDraftColor(): string {
  const calId = draftCalendarId() ?? defaultCalendarId();
  if (!calId) return "#4285f4";

  for (const account of connectedAccounts()) {
    for (const cal of account.calendars) {
      if (cal.id === calId) return cal.color;
    }
  }
  return "#4285f4";
}

// =============================================================================
// Actions
// =============================================================================

/**
 * Begin a new event creation from a drag interaction.
 * Sets the draft's start/end to the same snapped time (15-min block).
 */
export function startCreation(date: Date, snappedMinutes: number): void {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setMinutes(snappedMinutes);

  const end = new Date(start);
  end.setMinutes(start.getMinutes() + SNAP_MINUTES);

  setDraftStart(start);
  setDraftEnd(end);
  setDraftTitle("");
  setDraftCalendarId(defaultCalendarId());
  setIsDragging(true);
  setIsCreating(true);
}

/**
 * Update the draft time range during drag.
 * Handles bidirectional drag: origin stays fixed, current time extends in either direction.
 */
export function updateDrag(originMinutes: number, currentMinutes: number, date: Date): void {
  const minMin = Math.min(originMinutes, currentMinutes);
  const maxMin = Math.max(originMinutes, currentMinutes);

  // Ensure minimum duration of one snap increment
  const endMin = maxMin === minMin ? maxMin + SNAP_MINUTES : maxMin;

  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setMinutes(minMin);

  const end = new Date(date);
  end.setHours(0, 0, 0, 0);
  end.setMinutes(endMin);

  setDraftStart(start);
  setDraftEnd(end);
}

/**
 * Finish the drag — keep isCreating true so the form can appear
 */
export function finishDrag(): void {
  setIsDragging(false);
}

/**
 * Cancel the current creation (Escape or click-outside-without-title)
 */
export function cancelCreation(): void {
  setIsCreating(false);
  setIsDragging(false);
  setDraftStart(null);
  setDraftEnd(null);
  setDraftTitle("");
  setDraftCalendarId(null);
}

/**
 * Commit the event creation — returns the draft data for the caller to persist.
 * Resets creation state.
 */
export function commitCreation(): {
  title: string;
  start: Date;
  end: Date;
  calendarId: string;
} | null {
  const title = draftTitle().trim();
  const start = draftStart();
  const end = draftEnd();
  const calId = draftCalendarId() ?? defaultCalendarId();

  if (!title || !start || !end || !calId) return null;

  const result = { title, start: new Date(start), end: new Date(end), calendarId: calId };

  cancelCreation();
  return result;
}
