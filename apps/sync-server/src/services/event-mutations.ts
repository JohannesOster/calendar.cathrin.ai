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
  visibility?: string,
  reminders?: { method: string; minutes: number }[],
  colorId?: string,
  conferencing?: { type: "meet" } | { type: "manual"; uri: string } | null
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
    ...(reminders !== undefined && {
      reminders: reminders && reminders.length > 0
        ? { useDefault: false, overrides: reminders }
        : { useDefault: true },
    }),
    colorId,
    ...(conferencing?.type === "meet" && {
      conferenceData: {
        createRequest: {
          requestId: crypto.randomUUID(),
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    }),
  });

  // Extract conferencing from Google response
  const videoEntryPoint = googleEvent.conferenceData?.entryPoints
    ?.find(ep => ep.entryPointType === "video");
  const conferencingResult = videoEntryPoint
    ? { uri: videoEntryPoint.uri, label: googleEvent.conferenceData?.conferenceSolution?.name }
    : conferencing?.type === "manual" ? { uri: conferencing.uri } : undefined;

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
    isReadOnly: false,
    transparency: googleEvent.transparency || transparency || undefined,
    visibility: googleEvent.visibility || visibility || undefined,
    reminders: googleEvent.reminders?.overrides || reminders || undefined,
    colorId: googleEvent.colorId || colorId || undefined,
    conferencing: conferencingResult,
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
    reminders?: { method: string; minutes: number }[] | null;
    colorId?: string | null;
    conferencing?: { type: "meet" } | { type: "manual"; uri: string } | null;
  },
  existingEvent: ServerEvent
): Promise<ApiCalendarEvent> {
  const googlePatch: GoogleEventPatch = {};
  if (patch.summary !== undefined) googlePatch.summary = patch.summary;
  if (patch.description !== undefined) googlePatch.description = patch.description;
  if (patch.location !== undefined) googlePatch.location = patch.location;
  if (patch.transparency !== undefined) googlePatch.transparency = patch.transparency;
  if (patch.visibility !== undefined) googlePatch.visibility = patch.visibility;
  if (patch.reminders !== undefined) {
    googlePatch.reminders = patch.reminders && patch.reminders.length > 0
      ? { useDefault: false, overrides: patch.reminders }
      : { useDefault: true };
  }
  if (patch.colorId !== undefined) googlePatch.colorId = patch.colorId ?? undefined;
  if (patch.conferencing !== undefined) {
    if (patch.conferencing === null) {
      // Remove conferencing
      googlePatch.conferenceData = null;
    } else if (patch.conferencing.type === "meet") {
      googlePatch.conferenceData = {
        createRequest: {
          requestId: crypto.randomUUID(),
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      };
    }
    // Manual URLs don't go through Google's conferenceData — stored locally only
  }

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
      reminders: updated.reminders?.overrides || existingEvent.reminders || null,
      colorId: updated.colorId || null,
      ...(patch.conferencing !== undefined && {
        conferencing: (() => {
          if (patch.conferencing === null) return null;
          const ep = updated.conferenceData?.entryPoints?.find(e => e.entryPointType === "video");
          if (ep) return { uri: ep.uri, label: updated.conferenceData?.conferenceSolution?.name };
          if (patch.conferencing?.type === "manual") return { uri: patch.conferencing.uri };
          return existingEvent.conferencing;
        })(),
      }),
      updatedAt: new Date(),
    })
    .where(eq(serverEvents.id, existingEvent.id));

  // Resolve conferencing for response
  const updatedVideoEntryPoint = updated.conferenceData?.entryPoints
    ?.find(ep => ep.entryPointType === "video");
  let conferencingResult: { uri: string; label?: string } | undefined;
  if (patch.conferencing === null) {
    conferencingResult = undefined;
  } else if (updatedVideoEntryPoint) {
    conferencingResult = { uri: updatedVideoEntryPoint.uri, label: updated.conferenceData?.conferenceSolution?.name };
  } else if (patch.conferencing?.type === "manual") {
    conferencingResult = { uri: patch.conferencing.uri };
  } else {
    conferencingResult = (existingEvent.conferencing as { uri: string; label?: string }) || undefined;
  }

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
    isReadOnly: existingEvent.isReadOnly ?? false,
    readOnlyReason: existingEvent.readOnlyReason || undefined,
    transparency: updated.transparency || existingEvent.transparency || undefined,
    visibility: updated.visibility || existingEvent.visibility || undefined,
    reminders: (updated.reminders?.overrides || existingEvent.reminders as { method: string; minutes: number }[]) || undefined,
    colorId: updated.colorId || undefined,
    conferencing: conferencingResult,
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
