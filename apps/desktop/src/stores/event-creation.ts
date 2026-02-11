import { createSignal } from "solid-js";
import { defaultCalendarId, connectedAccounts } from "./accounts";
import { setDefaultCalendar } from "./account-ordering";
import { addLocalEvent, removeLocalEvent, setEvents } from "./events";
import { revalidateWeeksForDates } from "./event-polling";
import { apiFetch } from "../lib/api";
import { CATHRIN_PALETTE } from "../lib/color-mapping";
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
export const [draftTransparency, setDraftTransparency] = createSignal<"opaque" | "transparent">("opaque");
export const [draftVisibility, setDraftVisibility] = createSignal<"default" | "public" | "private">("default");
export const [draftReminders, setDraftReminders] = createSignal<{ method: "popup"; minutes: number }[]>([]);

// Shadow position: original start/end before inline time editing begins
export const [shadowStart, setShadowStart] = createSignal<Date | null>(null);
export const [shadowEnd, setShadowEnd] = createSignal<Date | null>(null);

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
  if (!calId) return CATHRIN_PALETTE.graphite;

  for (const account of connectedAccounts()) {
    for (const cal of account.calendars) {
      if (cal.id === calId) return cal.color;
    }
  }
  return CATHRIN_PALETTE.graphite;
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
  setDraftTransparency("opaque");
  setDraftVisibility("default");
  setDraftReminders([]);
  setShadowStart(null);
  setShadowEnd(null);
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
  const transparency = draftTransparency();
  const visibility = draftVisibility();
  const reminders = draftReminders();

  if (!title || !start || !end || !calId) return false;

  const color = getDraftColor();
  const tempId = `temp-${crypto.randomUUID()}`;

  // For all-day events: use UTC midnight dates to match Google Calendar convention.
  // allDayLayout.ts uses getUTCDateOnly() which extracts UTC date components,
  // so optimistic events must also use UTC midnight (not local midnight).
  // Google Calendar uses exclusive end dates (1-day event on Feb 9 → end = Feb 10).
  let eventStart = new Date(start);
  let eventEnd = new Date(end);
  let apiStart: string;
  let apiEnd: string;

  if (isAllDay) {
    // API date strings: use the calendar dates the user selected (local components)
    apiStart = formatDateOnly(start);
    const endNextDay = new Date(end);
    endNextDay.setDate(endNextDay.getDate() + 1);
    apiEnd = formatDateOnly(endNextDay);

    // Optimistic event dates: UTC midnight to match Google's convention
    eventStart = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()));
    eventEnd = new Date(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate() + 1));
  } else {
    apiStart = start.toISOString();
    apiEnd = end.toISOString();
  }

  // Optimistic insert
  addLocalEvent({
    id: tempId,
    calendarId: calId,
    title,
    start: eventStart,
    end: eventEnd,
    isAllDay,
    color,
    location,
    description,
    transparency,
    visibility,
    reminders: reminders.length > 0 ? reminders : undefined,
  });

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
      transparency,
      visibility,
      ...(reminders.length > 0 && { reminders }),
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
