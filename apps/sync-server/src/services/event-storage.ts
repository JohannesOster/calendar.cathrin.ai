import { sql } from "drizzle-orm";
import type { ApiCalendarEvent } from "@cathrin/shared-types";
import { serverEvents } from "../db/schema.js";
import type { db as dbType } from "../db/index.js";

type Db = NonNullable<typeof dbType>;

/**
 * Build the values object for a server event upsert
 */
function buildEventValues(
  event: ApiCalendarEvent,
  accountId: string,
  calendarId: string
) {
  return {
    accountId,
    calendarId,
    googleEventId: event.id,
    title: event.title,
    start: new Date(event.start),
    end: new Date(event.end),
    isAllDay: event.isAllDay,
    color: event.color,
    location: event.location ?? null,
    description: event.description ?? null,
    transparency: event.transparency ?? null,
    visibility: event.visibility ?? null,
    reminders: event.reminders ?? null,
    status: "confirmed" as const,
  };
}

/**
 * Build the conflict-update set for a single-event upsert
 */
function buildEventUpdateSet(event: ApiCalendarEvent) {
  return {
    title: event.title,
    start: new Date(event.start),
    end: new Date(event.end),
    isAllDay: event.isAllDay,
    color: event.color,
    location: event.location ?? null,
    description: event.description ?? null,
    transparency: event.transparency ?? null,
    visibility: event.visibility ?? null,
    reminders: event.reminders ?? null,
    updatedAt: new Date(),
  };
}

/**
 * Upsert a single event into the server cache
 */
export async function upsertServerEvent(
  db: Db,
  event: ApiCalendarEvent,
  accountId: string,
  calendarId: string
): Promise<void> {
  await db
    .insert(serverEvents)
    .values(buildEventValues(event, accountId, calendarId))
    .onConflictDoUpdate({
      target: [serverEvents.accountId, serverEvents.googleEventId],
      set: buildEventUpdateSet(event),
    });
}

/**
 * Upsert multiple events into the server cache in a single DB call.
 * Uses `excluded.*` to reference each incoming row's values on conflict.
 * No-ops when the events array is empty.
 */
export async function upsertServerEvents(
  db: Db,
  events: ApiCalendarEvent[],
  accountId: string,
  calendarId: string
): Promise<void> {
  if (events.length === 0) return;

  await db
    .insert(serverEvents)
    .values(events.map((e) => buildEventValues(e, accountId, calendarId)))
    .onConflictDoUpdate({
      target: [serverEvents.accountId, serverEvents.googleEventId],
      set: {
        title: sql`excluded.title`,
        start: sql`excluded.start`,
        end: sql`excluded."end"`,
        isAllDay: sql`excluded.is_all_day`,
        color: sql`excluded.color`,
        location: sql`excluded.location`,
        description: sql`excluded.description`,
        transparency: sql`excluded.transparency`,
        visibility: sql`excluded.visibility`,
        reminders: sql`excluded.reminders`,
        updatedAt: new Date(),
      },
    });
}
