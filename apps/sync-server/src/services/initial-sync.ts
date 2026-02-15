import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  accounts,
  calendarSyncState,
  fetchedWeeks,
} from "../db/schema.js";
import { getAccessToken } from "./token-refresh.js";
import { getProvider } from "../providers/registry.js";
import type { Provider } from "@cathrin/shared-types";
import { getWeeksInRange } from "../lib/week-utils.js";
import { upsertServerEvents } from "./event-storage.js";
import { createWatchChannelsForAccount } from "./watch-manager.js";
import { syncProviderContacts } from "./contacts-provider.js";

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
    // Look up provider for this account
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, accountId),
      columns: { provider: true, email: true },
    });
    if (!account) throw new Error("Account not found");

    const provider = getProvider(account.provider as Provider);
    const accessToken = await getAccessToken(accountId);

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
    const calendars = await provider.getCalendars(accessToken);
    console.log(`[initial-sync] Found ${calendars.length} calendars`);

    let totalEvents = 0;

    // Fetch events for each calendar
    for (const calendar of calendars) {
      try {
        const { events } = await provider.getEvents(accessToken, calendar.id, {
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          calendarColor: calendar.color,
          calendarAccessRole: calendar.accessRole,
          accountEmail: account.email,
        });

        console.log(
          `[initial-sync] Calendar "${calendar.name}": ${events.length} events`
        );

        // Store events in database
        await upsertServerEvents(db, events, accountId, calendar.id);

        totalEvents += events.length;

        // Get syncToken for future incremental syncs via provider abstraction
        let syncToken: string | null = null;
        try {
          syncToken = await provider.getInitialSyncToken(
            accessToken,
            calendar.id,
            timeMin.toISOString(),
            timeMax.toISOString(),
          );
          console.log(`[initial-sync] Got syncToken for "${calendar.name}"`);
        } catch (err) {
          console.error(
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
            accessRole: calendar.accessRole ?? null,
            syncToken,
            lastSyncAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [calendarSyncState.accountId, calendarSyncState.calendarId],
            set: {
              accessRole: calendar.accessRole ?? null,
              syncToken,
              lastSyncAt: new Date(),
            },
          });

        // Record all fetched weeks for on-demand fetching logic
        const weeksInRange = getWeeksInRange(timeMin, timeMax);
        console.log(
          `[initial-sync] Recording ${weeksInRange.length} fetched weeks for "${calendar.name}"`
        );

        for (const weekId of weeksInRange) {
          await db
            .insert(fetchedWeeks)
            .values({
              accountId,
              calendarId: calendar.id,
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

    // Create watch channels for push notifications (non-blocking)
    createWatchChannelsForAccount(accountId).catch((error) => {
      console.error(
        `[initial-sync] Failed to create watch channels for ${accountId}:`,
        error
      );
    });

    // Sync provider contacts (Google People API) immediately
    syncProviderContacts(accountId).catch((error) => {
      console.error(
        `[initial-sync] Failed to sync contacts for ${accountId}:`,
        error
      );
    });

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
