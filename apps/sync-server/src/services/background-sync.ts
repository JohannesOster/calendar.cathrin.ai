import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, calendarSyncState } from "../db/schema.js";
import { getAccessToken } from "./token-refresh.js";
import { GoogleCalendarService } from "./google-calendar.js";
import { syncCalendarIncremental, syncCalendarFull } from "./incremental-sync.js";
import { shouldCheckReanchor, checkAndReanchor } from "./reanchor.js";

// =============================================================================
// Sync Timing Configuration
// =============================================================================
// Server syncs with Google every 5 minutes using incremental sync (syncTokens).
// This is slower than client polling (3 minutes) to reduce Google API quota usage.
//
// Combined with client-side staleness (3 min) and polling (3 min), changes in
// Google Calendar propagate to the UI within approximately 3-8 minutes.
// =============================================================================

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes - sync with Google
const ACCOUNT_STAGGER_MS = 1000; // 1 second between accounts (rate limiting)
const INITIAL_DELAY_MS = 10_000; // 10 seconds after startup

let syncInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

/**
 * Start the background sync service
 * Runs periodic sync for all accounts with completed initial sync
 */
export function startBackgroundSync(): void {
  if (syncInterval) {
    console.log("[background-sync] Already running");
    return;
  }

  console.log(
    `[background-sync] Starting (interval: ${SYNC_INTERVAL_MS / 1000}s)`
  );

  // Schedule periodic sync
  syncInterval = setInterval(() => {
    runSyncCycle().catch((err) => {
      console.error("[background-sync] Sync cycle failed:", err);
    });
  }, SYNC_INTERVAL_MS);

  // Run first sync after short delay
  setTimeout(() => {
    runSyncCycle().catch((err) => {
      console.error("[background-sync] Initial sync cycle failed:", err);
    });
  }, INITIAL_DELAY_MS);
}

/**
 * Stop the background sync service
 */
export function stopBackgroundSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log("[background-sync] Stopped");
  }
}

/**
 * Check if background sync is running
 */
export function isBackgroundSyncRunning(): boolean {
  return syncInterval !== null;
}

/**
 * Helper to sleep for a given duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a complete sync cycle for all eligible accounts
 */
async function runSyncCycle(): Promise<void> {
  if (!db) {
    console.log("[background-sync] Database not configured, skipping");
    return;
  }

  if (isRunning) {
    console.log("[background-sync] Sync already in progress, skipping");
    return;
  }

  isRunning = true;
  const startTime = Date.now();

  try {
    console.log("[background-sync] Starting sync cycle");

    // Get all accounts that have completed initial sync
    const syncableAccounts = await db.query.accounts.findMany({
      where: eq(accounts.syncStatus, "complete"),
    });

    if (syncableAccounts.length === 0) {
      console.log("[background-sync] No accounts to sync");
      return;
    }

    console.log(
      `[background-sync] Syncing ${syncableAccounts.length} accounts`
    );

    let totalUpdated = 0;
    let totalDeleted = 0;
    let accountsSucceeded = 0;
    let accountsFailed = 0;

    for (const account of syncableAccounts) {
      try {
        const result = await syncAccount(account.id, account.email);
        totalUpdated += result.updated;
        totalDeleted += result.deleted;
        accountsSucceeded++;

        // Check if reanchoring is needed (once per day per account)
        if (shouldCheckReanchor(account.lastReanchorAt)) {
          try {
            const reanchorResult = await checkAndReanchor(account.id);
            if (reanchorResult.extended) {
              console.log(
                `[background-sync] Reanchored ${account.email}: ` +
                  `+${reanchorResult.futureWeeks} future, +${reanchorResult.pastWeeks} past weeks`
              );
            }
          } catch (reanchorError) {
            console.error(
              `[background-sync] Reanchor failed for ${account.email}:`,
              reanchorError
            );
            // Don't fail the account sync for reanchor errors
          }
        }
      } catch (error) {
        console.error(
          `[background-sync] Failed to sync account ${account.email}:`,
          error
        );
        accountsFailed++;
      }

      // Stagger between accounts to avoid rate limiting
      if (syncableAccounts.indexOf(account) < syncableAccounts.length - 1) {
        await sleep(ACCOUNT_STAGGER_MS);
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `[background-sync] Cycle complete in ${duration}ms: ` +
        `${accountsSucceeded} succeeded, ${accountsFailed} failed, ` +
        `${totalUpdated} updated, ${totalDeleted} deleted`
    );
  } finally {
    isRunning = false;
  }
}

/**
 * Sync a single account's calendars
 */
async function syncAccount(
  accountId: string,
  email: string
): Promise<{ updated: number; deleted: number }> {
  if (!db) {
    throw new Error("Database not configured");
  }

  // Get all calendars for this account
  const calendars = await db.query.calendarSyncState.findMany({
    where: eq(calendarSyncState.accountId, accountId),
  });

  if (calendars.length === 0) {
    // No calendars synced yet - fetch calendar list and set up sync state
    console.log(`[background-sync] No calendars for ${email}, fetching list`);
    await initializeCalendarSyncState(accountId);
    return { updated: 0, deleted: 0 };
  }

  let totalUpdated = 0;
  let totalDeleted = 0;

  // Get calendar colors for events
  const accessToken = await getAccessToken(accountId);
  const service = new GoogleCalendarService(accessToken);
  const calendarList = await service.fetchCalendarList();
  const colorMap = new Map(calendarList.map((c) => [c.id, c.color]));

  for (const calendar of calendars) {
    try {
      const color = colorMap.get(calendar.calendarId) || "#4285f4";

      if (calendar.syncToken) {
        // Do incremental sync
        const result = await syncCalendarIncremental(
          accountId,
          calendar.calendarId,
          color
        );
        totalUpdated += result.updated;
        totalDeleted += result.deleted;
      } else {
        // No syncToken - need full sync for this calendar
        console.log(
          `[background-sync] No syncToken for calendar ${calendar.calendarId}, doing full sync`
        );
        const now = new Date();
        const timeMin = new Date(now);
        timeMin.setMonth(timeMin.getMonth() - 6);
        const timeMax = new Date(now);
        timeMax.setMonth(timeMax.getMonth() + 6);

        const result = await syncCalendarFull(
          accountId,
          calendar.calendarId,
          color,
          timeMin,
          timeMax
        );
        totalUpdated += result.synced;
      }
    } catch (error) {
      console.error(
        `[background-sync] Failed to sync calendar ${calendar.calendarId}:`,
        error
      );
      // Continue with other calendars
    }
  }

  return { updated: totalUpdated, deleted: totalDeleted };
}

/**
 * Initialize sync state for a newly discovered account
 */
async function initializeCalendarSyncState(accountId: string): Promise<void> {
  if (!db) return;

  const accessToken = await getAccessToken(accountId);
  const service = new GoogleCalendarService(accessToken);
  const calendars = await service.fetchCalendarList();

  for (const calendar of calendars) {
    await db
      .insert(calendarSyncState)
      .values({
        accountId,
        calendarId: calendar.id,
        lastSyncAt: new Date(),
      })
      .onConflictDoNothing();
  }
}
