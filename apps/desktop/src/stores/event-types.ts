import type { ApiCalendarEvent } from "@cathrin/shared-types";
import { mapProviderColor, googleColorIdToCathrinKey, CATHRIN_PALETTE } from "../lib/color-mapping";
import type { CathrinColorKey } from "../lib/color-mapping";


/**
 * Event data for the frontend, with dates parsed to JS Date objects
 */
export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  color: string;
  location?: string;
  description?: string;
  transparency?: "opaque" | "transparent";
  visibility?: "default" | "public" | "private";
  reminders?: { method: "popup"; minutes: number }[];
  colorId?: CathrinColorKey;
}

export type EventPatch = {
  title?: string;
  description?: string;
  location?: string;
  start?: Date;
  end?: Date;
  isAllDay?: boolean;
  transparency?: "opaque" | "transparent";
  visibility?: "default" | "public" | "private";
  reminders?: { method: "popup"; minutes: number }[] | null;
  colorId?: CathrinColorKey | null;
};

export function convertApiEvent(event: ApiCalendarEvent): CalendarEvent {
  const cathrinKey = event.colorId ? googleColorIdToCathrinKey(event.colorId) : undefined;
  return {
    id: event.id,
    calendarId: event.calendarId,
    title: event.title,
    start: new Date(event.start),
    end: new Date(event.end),
    isAllDay: event.isAllDay,
    color: cathrinKey ? CATHRIN_PALETTE[cathrinKey] : mapProviderColor(event.color),
    location: event.location,
    description: event.description,
    transparency: event.transparency as CalendarEvent["transparency"],
    visibility: event.visibility as CalendarEvent["visibility"],
    reminders: event.reminders as CalendarEvent["reminders"],
    colorId: cathrinKey,
  };
}
