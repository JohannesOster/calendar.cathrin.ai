import { eq, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, serverEvents } from "../db/schema.js";
import { getAccessToken } from "./token-refresh.js";
import { getProvider } from "../providers/registry.js";
import type {
  ProviderEventPatch,
  MutationOptions,
  RsvpResponse,
} from "../providers/types.js";
import { upsertServerEvent } from "./event-storage.js";
import { mapServerEventToApi } from "./event-mapper.js";
import type { ApiCalendarEvent, Attendee, Provider } from "@cathrin/shared-types";
import type { InferSelectModel } from "drizzle-orm";

type ServerEvent = InferSelectModel<typeof serverEvents>;

export interface CreateEventOptions {
  accountId: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  isAllDay?: boolean;
  calendarColor?: string | null;
  location?: string;
  description?: string;
  transparency?: string;
  visibility?: string;
  reminders?: { method: string; minutes: number }[];
  colorId?: string;
  conferencing?: { type: "create" } | { type: "manual"; uri: string } | null;
  timeZone?: string;
  attendees?: { email: string; name?: string }[];
  sendUpdates?: "all" | "none";
  recurrence?: string[];
}

/**
 * Create an event via the calendar provider and cache it locally.
 * Returns the ApiCalendarEvent.
 */
export async function createEvent(opts: CreateEventOptions): Promise<ApiCalendarEvent> {
  const { accountId, calendarId, title, start, end, isAllDay, calendarColor, location, description, transparency, visibility, reminders, colorId, conferencing, timeZone, attendees, sendUpdates, recurrence } = opts;

  const account = await db!.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
    columns: { provider: true, email: true },
  });
  if (!account) throw new Error("Account not found");

  const provider = getProvider(account.provider as Provider);
  const accessToken = await getAccessToken(accountId);

  const mutationOptions: MutationOptions = {
    calendarColor: calendarColor || undefined,
    sendUpdates: attendees && attendees.length > 0 ? (sendUpdates ?? "all") : undefined,
    accountEmail: account.email,
  };

  const apiEvent = await provider.createEvent(
    accessToken,
    calendarId,
    {
      title,
      start,
      end,
      isAllDay,
      location,
      description,
      transparency,
      visibility,
      reminders,
      colorId,
      conferencing,
      attendees,
      timeZone,
      recurrence,
    },
    mutationOptions,
  );

  // Manual conferencing URIs are local-only — overlay after provider call
  if (conferencing?.type === "manual") {
    apiEvent.conferencing = { uri: conferencing.uri };
  }

  await upsertServerEvent(db!, apiEvent, accountId, calendarId);

  return apiEvent;
}

/**
 * Update an event via the calendar provider and update the local cache.
 * Returns the updated ApiCalendarEvent.
 */
export async function updateEvent(
  accountId: string,
  calendarId: string,
  providerEventId: string,
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
    conferencing?: { type: "create" } | { type: "manual"; uri: string } | null;
    timeZone?: string;
    attendees?: { email: string; name?: string }[] | null;
  },
  existingEvent: ServerEvent,
  sendUpdates?: "all" | "none"
): Promise<ApiCalendarEvent> {
  const account = await db!.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
    columns: { provider: true, email: true },
  });
  if (!account) throw new Error("Account not found");

  const calendarProvider = getProvider(account.provider as Provider);
  const accessToken = await getAccessToken(accountId);

  // Build provider patch
  const providerPatch: ProviderEventPatch = {
    summary: patch.summary,
    description: patch.description,
    location: patch.location,
    start: patch.start,
    end: patch.end,
    isAllDay: patch.isAllDay ?? (existingEvent.isAllDay ?? false),
    transparency: patch.transparency,
    visibility: patch.visibility,
    reminders: patch.reminders,
    colorId: patch.colorId,
    conferencing: patch.conferencing,
    attendees: patch.attendees,
    timeZone: patch.timeZone,
  };

  // If timeZone changes without dates, include existing dates for the provider
  // (providers need start/end present to apply a timeZone change)
  if (patch.timeZone && !patch.start && !(patch.isAllDay ?? existingEvent.isAllDay)) {
    providerPatch.start = existingEvent.start.toISOString();
  }
  if (patch.timeZone && !patch.end && !(patch.isAllDay ?? existingEvent.isAllDay)) {
    providerPatch.end = existingEvent.end.toISOString();
  }

  const mutationOptions: MutationOptions = {
    calendarColor: existingEvent.color || "#4285f4",
    sendUpdates: sendUpdates !== undefined
      ? sendUpdates
      : patch.attendees !== undefined ? "all" : undefined,
    accountEmail: account.email,
  };

  console.log(`[events] PATCH ${providerEventId} body:`, JSON.stringify(providerPatch));

  const apiEvent = await calendarProvider.updateEvent(
    accessToken, calendarId, providerEventId, providerPatch, mutationOptions
  );

  // Resolve conferencing:
  // - Manual URIs are local-only and must be overlaid
  // - If conferencing wasn't in the patch, preserve existing local value
  if (patch.conferencing !== undefined) {
    if (patch.conferencing === null) {
      apiEvent.conferencing = undefined;
    } else if (patch.conferencing.type === "manual") {
      apiEvent.conferencing = { uri: patch.conferencing.uri };
    }
  } else if (!apiEvent.conferencing) {
    apiEvent.conferencing = (existingEvent.conferencing as { uri: string; label?: string }) || undefined;
  }

  // Preserve timeZone from patch or existing event if provider didn't return one
  if (patch.timeZone !== undefined) {
    apiEvent.timeZone = patch.timeZone || undefined;
  } else if (!apiEvent.timeZone) {
    apiEvent.timeZone = existingEvent.timeZone || undefined;
  }

  await upsertServerEvent(db!, apiEvent, accountId, calendarId);

  return apiEvent;
}

/**
 * Delete an event via the calendar provider and remove from local cache.
 */
export async function deleteEvent(
  accountId: string,
  calendarId: string,
  providerEventId: string,
  eventDbId: string,
  sendUpdates?: "all" | "none",
  scope?: "single" | "all"
): Promise<void> {
  const account = await db!.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
    columns: { provider: true },
  });
  if (!account) throw new Error("Account not found");

  const provider = getProvider(account.provider as Provider);
  const accessToken = await getAccessToken(accountId);
  await provider.deleteEvent(
    accessToken, calendarId, providerEventId,
    sendUpdates ? { sendUpdates } : undefined,
  );

  if (scope === "all") {
    // Remove the master event and all instances from the DB cache.
    // The master's providerEventId becomes the recurringEventId for instances.
    await db!
      .delete(serverEvents)
      .where(
        or(
          eq(serverEvents.id, eventDbId),
          eq(serverEvents.recurringEventId, providerEventId),
        )
      );
  } else {
    await db!
      .delete(serverEvents)
      .where(eq(serverEvents.id, eventDbId));
  }
}

/**
 * Move an event to a different calendar via the calendar provider.
 * Updates calendarId and color in the local cache.
 * Returns the updated ApiCalendarEvent.
 *
 * IMPORTANT: Once the provider processes the move, the DB MUST be updated —
 * otherwise background sync will delete the event from the old calendar's
 * cache and it becomes invisible until the new calendar is re-fetched.
 */
export async function moveEvent(
  accountId: string,
  sourceCalendarId: string,
  destinationCalendarId: string,
  providerEventId: string,
  eventDbId: string,
  destinationColor: string | null
): Promise<ApiCalendarEvent> {
  const account = await db!.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
    columns: { provider: true },
  });
  if (!account) throw new Error("Account not found");

  const calendarProvider = getProvider(account.provider as Provider);

  if (!calendarProvider.moveEvent) {
    throw new Error(`Provider "${account.provider}" does not support moveEvent`);
  }

  const accessToken = await getAccessToken(accountId);
  await calendarProvider.moveEvent(accessToken, sourceCalendarId, providerEventId, destinationCalendarId);

  // Provider succeeded — update DB. If this fails, the event will vanish from
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
    console.error(`[events] CRITICAL: Provider moved event ${providerEventId} to ${destinationCalendarId} but DB update failed:`, dbError);
    throw dbError;
  }

  const updated = await db!.query.serverEvents.findFirst({
    where: eq(serverEvents.id, eventDbId),
  });

  return mapServerEventToApi(updated!, account.provider as Provider);
}

/**
 * Update the current user's RSVP status on an event via the calendar provider.
 * Reads the attendees array from DB, updates the self entry's responseStatus,
 * sends to the provider, and updates the local cache.
 */
export async function rsvpEvent(
  accountId: string,
  calendarId: string,
  providerEventId: string,
  responseStatus: RsvpResponse,
  existingEvent: ServerEvent,
  sendUpdates?: "all" | "none"
): Promise<ApiCalendarEvent> {
  const account = await db!.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
    columns: { provider: true },
  });
  if (!account) throw new Error("Account not found");

  const calendarProvider = getProvider(account.provider as Provider);
  const accessToken = await getAccessToken(accountId);

  const attendees = (existingEvent.attendees as Attendee[]) || [];
  if (attendees.length === 0) {
    throw new Error("Event has no attendees");
  }

  await calendarProvider.rsvpEvent(
    accessToken, calendarId, providerEventId, responseStatus,
    {
      currentAttendees: attendees,
      sendUpdates: sendUpdates ?? "none",
    },
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
  } as ServerEvent, account.provider as Provider);
}
