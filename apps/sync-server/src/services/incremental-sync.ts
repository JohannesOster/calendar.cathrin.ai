import { eq, and, inArray, lte, gte } from "drizzle-orm";
import { db } from "../db/index.js";
import { serverEvents, calendarSyncState, fetchedWeeks } from "../db/schema.js";
import { getAccessToken } from "./token-refresh.js";
import {
  GoogleCalendarService,
  SyncTokenExpiredError,
} from "./google-calendar.js";
import { getWeekId, getWeeksInRange } from "../lib/week-utils.js";
import { upsertServerEvents } from "./event-storage.js";

/**
 * Perform incremental sync for a calendar using its syncToken
 *
 * @param accountId - The account ID
 * @param calendarId - The Google Calendar ID
 * @param calendarColor - The calendar's color for events
 * @returns Number of events updated/deleted
 * @throws Error if no syncToken exists (full sync required)
 */
export async function syncCalendarIncremental(
  accountId: string,
  calendarId: string,
  calendarColor: string
): Promise<{ updated: number; deleted: number }> {
  if (!db) {
    throw new Error("Database not configured");
  }

  // Get current sync state
  const state = await db.query.calendarSyncState.findFirst({
    where: and(
      eq(calendarSyncState.accountId, accountId),
      eq(calendarSyncState.calendarId, calendarId)
    ),
  });

  if (!state?.syncToken) {
    throw new Error("No syncToken - full sync required");
  }

  const accessToken = await getAccessToken(accountId);
  const service = new GoogleCalendarService(accessToken);

  try {
    const { events, cancelledIds, nextSyncToken } =
      await service.fetchEventsIncremental(
        calendarId,
        state.syncToken,
        calendarColor
      );

    let updated = 0;
    let deleted = 0;
    const affectedWeekIds = new Set<string>();

    // Delete cancelled events
    for (const cancelledId of cancelledIds) {
      const existingEvent = await db.query.serverEvents.findFirst({
        where: and(
          eq(serverEvents.accountId, accountId),
          eq(serverEvents.googleEventId, cancelledId)
        ),
      });

      if (existingEvent) {
        affectedWeekIds.add(getWeekId(existingEvent.start));
        await db
          .delete(serverEvents)
          .where(eq(serverEvents.id, existingEvent.id));
        deleted++;
      }
    }

    // Upsert active events
    for (const event of events) {
      affectedWeekIds.add(getWeekId(new Date(event.start)));
    }
    await upsertServerEvents(db, events, accountId, calendarId);
    updated = events.length;

    // Update fetchedAt for all affected weeks
    if (affectedWeekIds.size > 0) {
      const weekIdArray = Array.from(affectedWeekIds);
      await db
        .update(fetchedWeeks)
        .set({ fetchedAt: new Date() })
        .where(
          and(
            eq(fetchedWeeks.accountId, accountId),
            eq(fetchedWeeks.calendarId, calendarId),
            inArray(fetchedWeeks.weekId, weekIdArray)
          )
        );
    }

    // Update sync token
    await db
      .update(calendarSyncState)
      .set({
        syncToken: nextSyncToken,
        lastSyncAt: new Date(),
      })
      .where(eq(calendarSyncState.id, state.id));

    return { updated, deleted };
  } catch (error) {
    if (error instanceof SyncTokenExpiredError) {
      // Clear syncToken to trigger full resync on next run
      console.log(
        `[incremental-sync] SyncToken expired for calendar ${calendarId}, clearing for full resync`
      );
      await db
        .update(calendarSyncState)
        .set({ syncToken: null })
        .where(eq(calendarSyncState.id, state.id));
    }
    throw error;
  }
}

/**
 * Perform full sync for a calendar and store the syncToken for future incremental syncs
 */
export async function syncCalendarFull(
  accountId: string,
  calendarId: string,
  calendarColor: string,
  timeMin: Date,
  timeMax: Date
): Promise<{ synced: number; syncToken: string }> {
  if (!db) {
    throw new Error("Database not configured");
  }

  const accessToken = await getAccessToken(accountId);
  const service = new GoogleCalendarService(accessToken);

  // Fetch all events in range
  const events = await service.fetchEvents(
    calendarId,
    timeMin.toISOString(),
    timeMax.toISOString(),
    calendarColor
  );

  // Store events
  await upsertServerEvents(db, events, accountId, calendarId);

  // Remove events in the fetched range that Google no longer returns
  const fetchedEventIds = new Set(events.map((e) => e.id));
  const existingInRange = await db.query.serverEvents.findMany({
    where: and(
      eq(serverEvents.accountId, accountId),
      eq(serverEvents.calendarId, calendarId),
      lte(serverEvents.start, timeMax),
      gte(serverEvents.end, timeMin)
    ),
    columns: { id: true, googleEventId: true },
  });

  let removed = 0;
  for (const existing of existingInRange) {
    if (!fetchedEventIds.has(existing.googleEventId)) {
      await db.delete(serverEvents).where(eq(serverEvents.id, existing.id));
      removed++;
    }
  }

  if (removed > 0) {
    console.log(
      `[incremental-sync] Removed ${removed} stale events for calendar ${calendarId}`
    );
  }

  // Now do a sync request to get the syncToken for future incremental syncs
  // We need to make a request with no time bounds to get a syncToken
  const syncTokenResponse = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?maxResults=1`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!syncTokenResponse.ok) {
    throw new Error(`Failed to get syncToken: ${syncTokenResponse.statusText}`);
  }

  const syncData = (await syncTokenResponse.json()) as {
    nextSyncToken?: string;
  };
  const syncToken = syncData.nextSyncToken || "";

  // Update sync state with token
  await db
    .insert(calendarSyncState)
    .values({
      accountId,
      calendarId,
      syncToken,
      lastSyncAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [calendarSyncState.accountId, calendarSyncState.calendarId],
      set: {
        syncToken,
        lastSyncAt: new Date(),
      },
    });

  // Record all fetched weeks
  const weeksInRange = getWeeksInRange(timeMin, timeMax);
  for (const weekId of weeksInRange) {
    await db
      .insert(fetchedWeeks)
      .values({
        accountId,
        calendarId,
        weekId,
      })
      .onConflictDoUpdate({
        target: [
          fetchedWeeks.accountId,
          fetchedWeeks.calendarId,
          fetchedWeeks.weekId,
        ],
        set: { fetchedAt: new Date() },
      });
  }

  return { synced: events.length, syncToken };
}
