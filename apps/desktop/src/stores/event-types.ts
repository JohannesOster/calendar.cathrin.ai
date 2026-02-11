import type { ApiCalendarEvent } from "@cathrin/shared-types";
import { mapProviderColor } from "../lib/color-mapping";


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
  isReadOnly: boolean;
  readOnlyReason?: string;
}

export type EventPatch = {
  title?: string;
  description?: string;
  location?: string;
  start?: Date;
  end?: Date;
  isAllDay?: boolean;
};

export function convertApiEvent(event: ApiCalendarEvent): CalendarEvent {
  return {
    id: event.id,
    calendarId: event.calendarId,
    title: event.title,
    start: new Date(event.start),
    end: new Date(event.end),
    isAllDay: event.isAllDay,
    color: mapProviderColor(event.color),
    location: event.location,
    description: event.description,
    isReadOnly: event.isReadOnly,
    readOnlyReason: event.readOnlyReason,
  };
}
