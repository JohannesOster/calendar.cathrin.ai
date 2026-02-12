import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { serverEvents } from "../db/schema.js";
import { getAccessToken } from "./token-refresh.js";
import {
  GoogleCalendarService,
  type GoogleEventPatch,
} from "./google-calendar.js";
import { upsertServerEvent } from "./event-storage.js";
import { mapServerEventToApi } from "./event-mapper.js";
import type { ApiCalendarEvent, Attendee } from "@cathrin/shared-types";
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
  conferencing?: { type: "meet" } | { type: "manual"; uri: string } | null,
  timeZone?: string,
  attendees?: { email: string; name?: string }[]
): Promise<ApiCalendarEvent> {
  const accessToken = await getAccessToken(accountId);
  const service = new GoogleCalendarService(accessToken);

  const googleEvent = await service.insertEvent(calendarId, {
    summary: title,
    start: isAllDay ? { date: start.slice(0, 10) } : { dateTime: start, ...(timeZone && { timeZone }) },
    end: isAllDay ? { date: end.slice(0, 10) } : { dateTime: end, ...(timeZone && { timeZone }) },
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
    ...(attendees && attendees.length > 0 && {
      attendees: attendees.map(a => ({ email: a.email, displayName: a.name })),
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
    timeZone: timeZone || undefined,
    attendees: googleEvent.attendees
      ?.filter(a => !a.resource)
      .map(a => ({
        email: a.email,
        name: a.displayName || undefined,
        responseStatus: (a.responseStatus || "needsAction") as Attendee["responseStatus"],
        isOrganizer: a.organizer || undefined,
        isSelf: a.self || undefined,
      })),
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
    timeZone?: string;
    attendees?: { email: string; name?: string }[] | null;
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
    googlePatch.reminders = {
      useDefault: false,
      overrides: patch.reminders && patch.reminders.length > 0 ? patch.reminders : [],
    };
  }
  if (patch.colorId !== undefined) googlePatch.colorId = patch.colorId ?? null;
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
  if (patch.attendees !== undefined) {
    googlePatch.attendees = patch.attendees
      ? patch.attendees.map(a => ({ email: a.email }))
      : [];
  }

  const useDate = patch.isAllDay ?? existingEvent.isAllDay;
  const patchTimeZone = !useDate ? patch.timeZone : undefined;
  if (patch.start !== undefined) {
    googlePatch.start = useDate
      ? { date: patch.start.slice(0, 10), dateTime: null }
      : { dateTime: patch.start, date: null, ...(patchTimeZone && { timeZone: patchTimeZone }) };
  } else if (patchTimeZone) {
    googlePatch.start = { dateTime: existingEvent.start.toISOString(), date: null, timeZone: patchTimeZone };
  }
  if (patch.end !== undefined) {
    googlePatch.end = useDate
      ? { date: patch.end.slice(0, 10), dateTime: null }
      : { dateTime: patch.end, date: null, ...(patchTimeZone && { timeZone: patchTimeZone }) };
  } else if (patchTimeZone) {
    googlePatch.end = { dateTime: existingEvent.end.toISOString(), date: null, timeZone: patchTimeZone };
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
      reminders: patch.reminders !== undefined
        ? (patch.reminders && patch.reminders.length > 0
          ? (updated.reminders?.overrides || patch.reminders)
          : null)
        : (updated.reminders?.overrides || existingEvent.reminders || null),
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
      ...(patch.timeZone !== undefined && {
        timeZone: patch.timeZone || null,
      }),
      ...(patch.attendees !== undefined && {
        attendees: updated.attendees
          ?.filter(a => !a.resource)
          .map(a => ({
            email: a.email,
            name: a.displayName || undefined,
            responseStatus: (a.responseStatus || "needsAction"),
            isOrganizer: a.organizer || undefined,
            isSelf: a.self || undefined,
          })) ?? null,
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
    reminders: patch.reminders !== undefined
      ? (patch.reminders && patch.reminders.length > 0
        ? (updated.reminders?.overrides || patch.reminders || undefined)
        : undefined)
      : ((updated.reminders?.overrides || existingEvent.reminders) as { method: string; minutes: number }[] | undefined),
    colorId: updated.colorId || undefined,
    conferencing: conferencingResult,
    timeZone: patch.timeZone !== undefined
      ? (patch.timeZone || undefined)
      : (existingEvent.timeZone || undefined),
    attendees: patch.attendees !== undefined
      ? (updated.attendees
          ?.filter(a => !a.resource)
          .map(a => ({
            email: a.email,
            name: a.displayName || undefined,
            responseStatus: (a.responseStatus || "needsAction") as Attendee["responseStatus"],
            isOrganizer: a.organizer || undefined,
            isSelf: a.self || undefined,
          })) || undefined)
      : (existingEvent.attendees as Attendee[] | undefined),
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

/**
 * Move an event to a different calendar via Google Calendar API.
 * Updates calendarId and color in the local cache.
 * Returns the updated ApiCalendarEvent.
 *
 * IMPORTANT: Once Google processes the move, the DB MUST be updated —
 * otherwise background sync will delete the event from the old calendar's
 * cache and it becomes invisible until the new calendar is re-fetched.
 */
export async function moveEventViaGoogle(
  accountId: string,
  sourceCalendarId: string,
  destinationCalendarId: string,
  googleEventId: string,
  eventDbId: string,
  destinationColor: string | null
): Promise<ApiCalendarEvent> {
  const accessToken = await getAccessToken(accountId);
  const service = new GoogleCalendarService(accessToken);
  await service.moveEvent(sourceCalendarId, googleEventId, destinationCalendarId);

  // Google succeeded — update DB. If this fails, the event will vanish from
  // the UI until the next full sync picks it up from the new calendar.
  const color = destinationColor || "#4285f4";

  try {
    await db!
      .update(serverEvents)
      .set({
        calendarId: destinationCalendarId,
        color,
        updatedAt: new Date(),
      })
      .where(eq(serverEvents.id, eventDbId));
  } catch (dbError) {
    console.error(`[events] CRITICAL: Google moved event ${googleEventId} to ${destinationCalendarId} but DB update failed:`, dbError);
    throw dbError;
  }

  const updated = await db!.query.serverEvents.findFirst({
    where: eq(serverEvents.id, eventDbId),
  });

  return mapServerEventToApi(updated!);
}

/**
 * Update the current user's RSVP status on an event via Google Calendar API.
 * Reads the attendees array from DB, updates the self entry's responseStatus,
 * PATCHes to Google, and updates the local cache.
 */
export async function rsvpEventViaGoogle(
  accountId: string,
  calendarId: string,
  googleEventId: string,
  responseStatus: "accepted" | "declined" | "tentative",
  existingEvent: ServerEvent
): Promise<ApiCalendarEvent> {
  const attendees = (existingEvent.attendees as Attendee[]) || [];
  if (attendees.length === 0) {
    throw new Error("Event has no attendees");
  }

  // Build the Google-format attendees array with updated self status
  const googleAttendees = attendees.map(a => ({
    email: a.email,
    responseStatus: a.isSelf ? responseStatus : a.responseStatus,
    ...(a.isOrganizer && { organizer: true }),
    ...(a.isSelf && { self: true }),
  }));

  const accessToken = await getAccessToken(accountId);
  const service = new GoogleCalendarService(accessToken);
  await service.patchEvent(
    calendarId,
    googleEventId,
    { attendees: googleAttendees },
    { sendUpdates: "none" }
  );

  // Update attendees in local DB
  const updatedAttendees = attendees.map(a =>
    a.isSelf ? { ...a, responseStatus } : a
  );

  await db!
    .update(serverEvents)
    .set({ attendees: updatedAttendees, updatedAt: new Date() })
    .where(eq(serverEvents.id, existingEvent.id));

  return mapServerEventToApi({
    ...existingEvent,
    attendees: updatedAttendees,
  } as ServerEvent);
}
