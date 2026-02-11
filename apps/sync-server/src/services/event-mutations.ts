import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { serverEvents } from "../db/schema.js";
import { getAccessToken } from "./token-refresh.js";
import {
  GoogleCalendarService,
  type GoogleEventPatch,
} from "./google-calendar.js";
import { upsertServerEvent } from "./event-storage.js";
import type { ApiCalendarEvent } from "@cathrin/shared-types";
import type { InferSelectModel } from "drizzle-orm";

type ServerEvent = InferSelectModel<typeof serverEvents>;

/**
 * Create an event via Google Calendar API and cache it locally.
 * Returns the ApiCalendarEvent.
 */
export async function createEventViaGoogle(
  accountId: string,
  calendarId: string,
  title: string,
  start: string,
  end: string,
  isAllDay?: boolean,
  calendarColor?: string | null,
  location?: string,
  description?: string,
  transparency?: string,
  visibility?: string
): Promise<ApiCalendarEvent> {
  const accessToken = await getAccessToken(accountId);
  const service = new GoogleCalendarService(accessToken);

  const googleEvent = await service.insertEvent(calendarId, {
    summary: title,
    start: isAllDay ? { date: start.slice(0, 10) } : { dateTime: start },
    end: isAllDay ? { date: end.slice(0, 10) } : { dateTime: end },
    location,
    description,
    transparency,
    visibility,
  });

  const color = calendarColor || "#4285f4";
  const eventStart = isAllDay
    ? new Date(googleEvent.start.date!)
    : new Date(googleEvent.start.dateTime!);
  const eventEnd = isAllDay
    ? new Date(googleEvent.end.date!)
    : new Date(googleEvent.end.dateTime!);

  const apiEvent: ApiCalendarEvent = {
    id: googleEvent.id,
    calendarId,
    title: googleEvent.summary || title,
    start: eventStart.toISOString(),
    end: eventEnd.toISOString(),
    isAllDay: isAllDay ?? false,
    color,
    provider: "google",
    location: googleEvent.location || location || undefined,
    description: googleEvent.description || description || undefined,
    transparency: googleEvent.transparency || transparency || undefined,
    visibility: googleEvent.visibility || visibility || undefined,
  };

  await upsertServerEvent(db!, apiEvent, accountId, calendarId);

  return apiEvent;
}

/**
 * Update an event via Google Calendar API and update the local cache.
 * Returns the updated ApiCalendarEvent.
 */
export async function updateEventViaGoogle(
  accountId: string,
  calendarId: string,
  googleEventId: string,
  patch: {
    summary?: string;
    description?: string;
    location?: string;
    start?: string;
    end?: string;
    isAllDay?: boolean;
    transparency?: string;
    visibility?: string;
  },
  existingEvent: ServerEvent
): Promise<ApiCalendarEvent> {
  const googlePatch: GoogleEventPatch = {};
  if (patch.summary !== undefined) googlePatch.summary = patch.summary;
  if (patch.description !== undefined) googlePatch.description = patch.description;
  if (patch.location !== undefined) googlePatch.location = patch.location;
  if (patch.transparency !== undefined) googlePatch.transparency = patch.transparency;
  if (patch.visibility !== undefined) googlePatch.visibility = patch.visibility;

  const useDate = patch.isAllDay ?? existingEvent.isAllDay;
  if (patch.start !== undefined) {
    googlePatch.start = useDate
      ? { date: patch.start.slice(0, 10), dateTime: null }
      : { dateTime: patch.start, date: null };
  }
  if (patch.end !== undefined) {
    googlePatch.end = useDate
      ? { date: patch.end.slice(0, 10), dateTime: null }
      : { dateTime: patch.end, date: null };
  }

  console.log(`[events] PATCH ${googleEventId} body:`, JSON.stringify(googlePatch));
  const accessToken = await getAccessToken(accountId);
  const service = new GoogleCalendarService(accessToken);
  const updated = await service.patchEvent(calendarId, googleEventId, googlePatch);

  const updatedStart = updated.start.dateTime
    ? new Date(updated.start.dateTime)
    : updated.start.date
      ? new Date(updated.start.date)
      : existingEvent.start;
  const updatedEnd = updated.end.dateTime
    ? new Date(updated.end.dateTime)
    : updated.end.date
      ? new Date(updated.end.date)
      : existingEvent.end;

  await db!
    .update(serverEvents)
    .set({
      title: updated.summary || existingEvent.title,
      start: updatedStart,
      end: updatedEnd,
      isAllDay: !!updated.start.date,
      location: updated.location || null,
      description: updated.description || null,
      transparency: updated.transparency || existingEvent.transparency || null,
      visibility: updated.visibility || existingEvent.visibility || null,
      updatedAt: new Date(),
    })
    .where(eq(serverEvents.id, existingEvent.id));

  return {
    id: updated.id,
    calendarId: existingEvent.calendarId,
    title: updated.summary || existingEvent.title,
    start: updatedStart.toISOString(),
    end: updatedEnd.toISOString(),
    isAllDay: !!updated.start.date,
    color: existingEvent.color || "#4285f4",
    provider: "google",
    location: updated.location || undefined,
    description: updated.description || undefined,
    transparency: updated.transparency || existingEvent.transparency || undefined,
    visibility: updated.visibility || existingEvent.visibility || undefined,
  };
}

/**
 * Delete an event via Google Calendar API and remove from local cache.
 */
export async function deleteEventViaGoogle(
  accountId: string,
  calendarId: string,
  googleEventId: string,
  eventDbId: string
): Promise<void> {
  const accessToken = await getAccessToken(accountId);
  const service = new GoogleCalendarService(accessToken);
  await service.deleteEvent(calendarId, googleEventId);

  await db!
    .delete(serverEvents)
    .where(eq(serverEvents.id, eventDbId));
}
