import { sql } from "drizzle-orm";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { ApiCalendarEvent } from "@cathrin/shared-types";
import { serverEvents } from "../db/schema.js";
import type { db as dbType } from "../db/index.js";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schema.js";

type Db = NonNullable<typeof dbType>;
type DbTransaction = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
/** Accepts both the root db instance and a transaction */
export type DbOrTx = Db | DbTransaction;

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
    providerEventId: event.id,
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
    colorId: event.colorId ?? null,
    conferencing: event.conferencing ?? null,
    timeZone: event.timeZone ?? null,
    attendees: event.attendees ?? null,
    icalUid: event.icalUid ?? null,
    recurrence: event.recurrence ?? null,
    recurringEventId: event.recurringEventId ?? null,
    status: "confirmed" as const,
    isReadOnly: event.isReadOnly,
    readOnlyReason: event.readOnlyReason ?? null,
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
    isReadOnly: event.isReadOnly,
    readOnlyReason: event.readOnlyReason ?? null,
    transparency: event.transparency ?? null,
    visibility: event.visibility ?? null,
    reminders: event.reminders ?? null,
    colorId: event.colorId ?? null,
    conferencing: event.conferencing ?? null,
    timeZone: event.timeZone ?? null,
    attendees: event.attendees ?? null,
    icalUid: event.icalUid ?? null,
    recurrence: event.recurrence ?? null,
    recurringEventId: event.recurringEventId ?? null,
    updatedAt: new Date(),
  };
}

/**
 * Upsert a single event into the server cache
 */
export async function upsertServerEvent(
  db: DbOrTx,
  event: ApiCalendarEvent,
  accountId: string,
  calendarId: string
): Promise<void> {
  await db
    .insert(serverEvents)
    .values(buildEventValues(event, accountId, calendarId))
    .onConflictDoUpdate({
      target: [serverEvents.accountId, serverEvents.providerEventId],
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
      target: [serverEvents.accountId, serverEvents.providerEventId],
      set: {
        title: sql`excluded.title`,
        start: sql`excluded.start`,
        end: sql`excluded."end"`,
        isAllDay: sql`excluded.is_all_day`,
        color: sql`excluded.color`,
        location: sql`excluded.location`,
        description: sql`excluded.description`,
        isReadOnly: sql`excluded.is_read_only`,
        readOnlyReason: sql`excluded.read_only_reason`,
        transparency: sql`excluded.transparency`,
        visibility: sql`excluded.visibility`,
        reminders: sql`excluded.reminders`,
        colorId: sql`excluded.color_id`,
        conferencing: sql`excluded.conferencing`,
        timeZone: sql`excluded.time_zone`,
        attendees: sql`excluded.attendees`,
        icalUid: sql`excluded.ical_uid`,
        recurrence: sql`excluded.recurrence`,
        recurringEventId: sql`excluded.recurring_event_id`,
        updatedAt: new Date(),
      },
    });
}
