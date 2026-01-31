import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { serverEvents, calendarSyncState } from "../db/schema.js";
import { getAccessToken } from "./token-refresh.js";
import {
  GoogleCalendarService,
  SyncTokenExpiredError,
} from "./google-calendar.js";

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
    const { events, nextSyncToken } = await service.fetchEventsIncremental(
      calendarId,
      state.syncToken,
      calendarColor
    );

    let updated = 0;
    let deleted = 0;

    // Process each event
    for (const event of events) {
      // Check if this is a cancelled (deleted) event
      // The API returns events with empty titles and we need to check raw status
      // For incremental sync, deleted events come back in the response
      const existingEvent = await db.query.serverEvents.findFirst({
        where: and(
          eq(serverEvents.accountId, accountId),
          eq(serverEvents.googleEventId, event.id)
        ),
      });

      if (event.title === "(No title)" && !event.start && !event.end) {
        // This is likely a deleted event - remove it
        if (existingEvent) {
          await db
            .delete(serverEvents)
            .where(eq(serverEvents.id, existingEvent.id));
          deleted++;
        }
      } else {
        // Upsert the event
        await db
          .insert(serverEvents)
          .values({
            accountId,
            calendarId,
            googleEventId: event.id,
            title: event.title,
            start: new Date(event.start),
            end: new Date(event.end),
            isAllDay: event.isAllDay,
            color: event.color,
            status: "confirmed",
          })
          .onConflictDoUpdate({
            target: [serverEvents.accountId, serverEvents.googleEventId],
            set: {
              title: event.title,
              start: new Date(event.start),
              end: new Date(event.end),
              isAllDay: event.isAllDay,
              color: event.color,
              updatedAt: new Date(),
            },
          });
        updated++;
      }
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
  for (const event of events) {
    await db
      .insert(serverEvents)
      .values({
        accountId,
        calendarId,
        googleEventId: event.id,
        title: event.title,
        start: new Date(event.start),
        end: new Date(event.end),
        isAllDay: event.isAllDay,
        color: event.color,
        status: "confirmed",
      })
      .onConflictDoUpdate({
        target: [serverEvents.accountId, serverEvents.googleEventId],
        set: {
          title: event.title,
          start: new Date(event.start),
          end: new Date(event.end),
          isAllDay: event.isAllDay,
          color: event.color,
          updatedAt: new Date(),
        },
      });
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

  return { synced: events.length, syncToken };
}
