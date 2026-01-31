import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, serverEvents, calendarSyncState } from "../db/schema.js";
import { getAccessToken } from "./token-refresh.js";
import { GoogleCalendarService } from "./google-calendar.js";

// Initial sync window: ±6 months
const INITIAL_SYNC_MONTHS_BEFORE = 6;
const INITIAL_SYNC_MONTHS_AFTER = 6;

/**
 * Perform initial sync for a newly connected account
 * Fetches events for ±6 months and stores them in the database
 *
 * This runs in the background after OAuth completes
 */
export async function performInitialSync(accountId: string): Promise<void> {
  if (!db) {
    console.error("[initial-sync] Database not configured");
    return;
  }

  console.log(`[initial-sync] Starting initial sync for account ${accountId}`);

  // Update status to syncing
  await db
    .update(accounts)
    .set({ syncStatus: "syncing", syncError: null })
    .where(eq(accounts.id, accountId));

  try {
    // Get access token (will refresh if needed)
    const accessToken = await getAccessToken(accountId);
    const service = new GoogleCalendarService(accessToken);

    // Calculate date bounds
    const now = new Date();
    const timeMin = new Date(now);
    timeMin.setMonth(timeMin.getMonth() - INITIAL_SYNC_MONTHS_BEFORE);
    timeMin.setHours(0, 0, 0, 0);

    const timeMax = new Date(now);
    timeMax.setMonth(timeMax.getMonth() + INITIAL_SYNC_MONTHS_AFTER);
    timeMax.setHours(23, 59, 59, 999);

    console.log(
      `[initial-sync] Fetching events from ${timeMin.toISOString()} to ${timeMax.toISOString()}`
    );

    // Fetch all calendars
    const calendars = await service.fetchCalendarList();
    console.log(`[initial-sync] Found ${calendars.length} calendars`);

    let totalEvents = 0;

    // Fetch events for each calendar
    for (const calendar of calendars) {
      try {
        const events = await service.fetchEvents(
          calendar.id,
          timeMin.toISOString(),
          timeMax.toISOString(),
          calendar.color
        );

        console.log(
          `[initial-sync] Calendar "${calendar.name}": ${events.length} events`
        );

        // Store events in database
        for (const event of events) {
          await db
            .insert(serverEvents)
            .values({
              accountId,
              calendarId: calendar.id,
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

        totalEvents += events.length;

        // Get syncToken for future incremental syncs
        // This requires a separate API call with no time bounds
        let syncToken: string | null = null;
        try {
          const syncTokenResponse = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?maxResults=1`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );
          if (syncTokenResponse.ok) {
            const syncData = (await syncTokenResponse.json()) as {
              nextSyncToken?: string;
            };
            syncToken = syncData.nextSyncToken || null;
          }
        } catch (err) {
          console.warn(
            `[initial-sync] Failed to get syncToken for calendar "${calendar.name}":`,
            err
          );
        }

        // Store sync state with token for incremental sync
        await db
          .insert(calendarSyncState)
          .values({
            accountId,
            calendarId: calendar.id,
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
      } catch (error) {
        console.error(
          `[initial-sync] Failed to sync calendar "${calendar.name}":`,
          error
        );
        // Continue with other calendars
      }
    }

    // Update status to complete
    await db
      .update(accounts)
      .set({
        syncStatus: "complete",
        lastSyncAt: new Date(),
        syncError: null,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, accountId));

    console.log(
      `[initial-sync] Completed for account ${accountId}: ${totalEvents} events synced`
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`[initial-sync] Failed for account ${accountId}:`, error);

    await db
      .update(accounts)
      .set({
        syncStatus: "failed",
        syncError: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, accountId));

    throw error;
  }
}

/**
 * Retry initial sync for a failed account
 */
export async function retryInitialSync(accountId: string): Promise<void> {
  if (!db) {
    throw new Error("Database not configured");
  }

  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });

  if (!account) {
    throw new Error("Account not found");
  }

  if (account.syncStatus !== "failed") {
    throw new Error(`Cannot retry sync - status is ${account.syncStatus}`);
  }

  await performInitialSync(accountId);
}
