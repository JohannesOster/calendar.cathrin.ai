import type { ApiCalendarEvent, Attendee } from "@cathrin/shared-types";
import type { serverEvents } from "../db/schema.js";
import type { InferSelectModel } from "drizzle-orm";

type ServerEvent = InferSelectModel<typeof serverEvents>;

/**
 * Map a server event DB row to an ApiCalendarEvent response
 */
export function mapServerEventToApi(event: ServerEvent): ApiCalendarEvent {
  return {
    id: event.googleEventId,
    calendarId: event.calendarId,
    title: event.title,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
    isAllDay: event.isAllDay ?? false,
    color: event.color || "#4285f4",
    provider: "google",
    location: event.location || undefined,
    description: event.description || undefined,
    isReadOnly: event.isReadOnly ?? false,
    readOnlyReason: event.readOnlyReason || undefined,
    transparency: event.transparency || undefined,
    visibility: event.visibility || undefined,
    reminders: (event.reminders as { method: string; minutes: number }[]) || undefined,
    colorId: event.colorId || undefined,
    conferencing: (event.conferencing as { uri: string; label?: string }) || undefined,
    timeZone: event.timeZone || undefined,
    attendees: (event.attendees as Attendee[]) || undefined,
  };
}
