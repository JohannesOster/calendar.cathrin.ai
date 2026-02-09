import { createSignal } from "solid-js";
import { defaultCalendarId, connectedAccounts, setDefaultCalendar } from "./accounts";
import { addLocalEvent, removeLocalEvent, setEvents, revalidateWeeksForDates } from "./events";
import { apiFetch } from "../lib/api";
import { SNAP_MINUTES } from "../constants/calendar";
import type { ApiCalendarEvent } from "@cathrin/shared-types";

// =============================================================================
// Signals
// =============================================================================
export const [isCreating, setIsCreating] = createSignal(false);
export const [isDragging, setIsDragging] = createSignal(false);
export const [draftStart, setDraftStart] = createSignal<Date | null>(null);
export const [draftEnd, setDraftEnd] = createSignal<Date | null>(null);
export const [draftTitle, setDraftTitle] = createSignal("");
export const [draftCalendarId, setDraftCalendarId] = createSignal<string | null>(null);
export const [draftLocation, setDraftLocation] = createSignal("");
export const [draftDescription, setDraftDescription] = createSignal("");
export const [draftIsAllDay, setDraftIsAllDay] = createSignal(false);

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
  const calId = draftCalendarId() ?? resolveCalendarId();
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
 * Resolve the calendar ID to use for new events.
 * Falls back to the first visible calendar and persists it as default.
 */
function resolveCalendarId(): string | null {
  const saved = defaultCalendarId();
  if (saved) return saved;

  // Fall back to first visible calendar
  for (const account of connectedAccounts()) {
    for (const cal of account.calendars) {
      if (cal.visible) {
        setDefaultCalendar(cal.id);
        return cal.id;
      }
    }
  }
  return null;
}

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
  setDraftCalendarId(resolveCalendarId());
  setIsDragging(true);
  setIsCreating(true);
}

/**
 * Update the draft time range during drag.
 * Supports multi-day drag: builds full Date objects from two date+time pairs,
 * then uses min/max so backward drag works naturally.
 */
export function updateDrag(
  originMinutes: number,
  currentMinutes: number,
  originDate: Date,
  currentDate: Date,
): void {
  const originDateTime = new Date(originDate);
  originDateTime.setHours(0, 0, 0, 0);
  originDateTime.setMinutes(originMinutes);

  const currentDateTime = new Date(currentDate);
  currentDateTime.setHours(0, 0, 0, 0);
  currentDateTime.setMinutes(currentMinutes);

  let start: Date;
  let end: Date;

  if (originDateTime.getTime() <= currentDateTime.getTime()) {
    start = originDateTime;
    end = currentDateTime;
  } else {
    start = currentDateTime;
    end = originDateTime;
  }

  // Ensure minimum duration of one snap increment
  if (end.getTime() - start.getTime() < SNAP_MINUTES * 60 * 1000) {
    end = new Date(start.getTime() + SNAP_MINUTES * 60 * 1000);
  }

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
  setDraftLocation("");
  setDraftDescription("");
  setDraftIsAllDay(false);
}

/**
 * Commit the event creation — optimistic insert + background API call.
 * Returns true if the event was saved, false if nothing to save.
 */
/**
 * Format a Date as YYYY-MM-DD for all-day event API calls.
 */
function formatDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function commitCreation(): boolean {
  const title = draftTitle().trim();
  const start = draftStart();
  const end = draftEnd();
  const calId = draftCalendarId() ?? resolveCalendarId();
  const isAllDay = draftIsAllDay();
  const location = draftLocation().trim() || undefined;
  const description = draftDescription().trim() || undefined;

  if (!title || !start || !end || !calId) return false;

  const color = getDraftColor();
  const tempId = `temp-${crypto.randomUUID()}`;

  // Optimistic insert
  addLocalEvent({
    id: tempId,
    calendarId: calId,
    title,
    start: new Date(start),
    end: new Date(end),
    isAllDay,
    color,
    location,
    description,
  });

  // Format start/end for API: date-only for all-day, ISO dateTime for timed
  const apiStart = isAllDay ? formatDateOnly(start) : start.toISOString();
  const apiEnd = isAllDay ? formatDateOnly(end) : end.toISOString();

  // Reset creation state
  cancelCreation();

  // Background API call
  apiFetch<ApiCalendarEvent>("/api/events", {
    method: "POST",
    body: JSON.stringify({
      calendarId: calId,
      title,
      start: apiStart,
      end: apiEnd,
      isAllDay,
      location,
      description,
    }),
  })
    .then((serverEvent) => {
      // Swap temp ID with server-assigned ID
      setEvents((prev) =>
        prev.map((e) =>
          e.id === tempId
            ? {
                ...e,
                id: serverEvent.id,
                title: serverEvent.title,
                start: new Date(serverEvent.start),
                end: new Date(serverEvent.end),
              }
            : e
        )
      );
      // Revalidate the affected week to sync with server state
      revalidateWeeksForDates(new Date(serverEvent.start));
    })
    .catch((error) => {
      console.error("[event-creation] Failed to save event:", error);
      removeLocalEvent(tempId);
    });

  return true;
}
