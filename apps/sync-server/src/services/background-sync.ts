import { eq, or, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, calendarSyncState, watchChannels } from "../db/schema.js";
import { getAccessToken } from "./token-refresh.js";
import { GoogleCalendarService } from "./google-calendar.js";
import { syncCalendarIncremental, syncCalendarFull } from "./incremental-sync.js";
import { shouldCheckReanchor, checkAndReanchor } from "./reanchor.js";
import { performInitialSync } from "./initial-sync.js";
import { notifyUser } from "./ws-manager.js";
import { isWatchEnabled, renewExpiringChannels, createWatchChannelsForAccount } from "./watch-manager.js";
import { shouldSyncContacts, syncProviderContacts } from "./contacts-provider.js";

// =============================================================================
// Sync Timing Configuration
// =============================================================================
// With watch channels: Google pushes changes → webhook → incremental sync.
// Background sync acts as safety net only (hourly). Without watch channels
// (e.g. no WEBHOOK_BASE_URL), poll every 2 minutes as before.
// =============================================================================

const SYNC_INTERVAL_POLLING_MS = 2 * 60 * 1000;  // 2 min - active polling fallback
const SYNC_INTERVAL_SAFETY_MS = 60 * 60 * 1000;  // 1 hour - safety net when watch active
const CHANNEL_RENEWAL_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours - check channel renewals
const ACCOUNT_STAGGER_MS = 1000; // 1 second between accounts (rate limiting)
const INITIAL_DELAY_MS = 10_000; // 10 seconds after startup
const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes - consider account stuck

let syncInterval: ReturnType<typeof setInterval> | null = null;
let renewalInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let recoveryRan = false; // Ensure recovery only runs once per server lifetime

/**
 * Start the background sync service
 * Runs periodic sync for all accounts with completed initial sync
 */
export function startBackgroundSync(): void {
  if (syncInterval) {
    console.log("[background-sync] Already running");
    return;
  }

  const watchActive = isWatchEnabled();
  const intervalMs = watchActive ? SYNC_INTERVAL_SAFETY_MS : SYNC_INTERVAL_POLLING_MS;

  console.log(
    `[background-sync] Starting (interval: ${intervalMs / 1000}s, watch: ${watchActive ? "active" : "polling"})`
  );

  // Schedule periodic sync
  syncInterval = setInterval(() => {
    runSyncCycle().catch((err) => {
      console.error("[background-sync] Sync cycle failed:", err);
    });
  }, intervalMs);

  // Schedule watch channel renewal checks (only when watch is active)
  if (watchActive) {
    renewalInterval = setInterval(() => {
      renewExpiringChannels().catch((err) => {
        console.error("[background-sync] Channel renewal failed:", err);
      });
    }, CHANNEL_RENEWAL_INTERVAL_MS);
  }

  // Run recovery and first sync after short delay
  setTimeout(async () => {
    // Recover stuck accounts before first sync cycle
    await recoverStuckAccounts();

    // Bootstrap watch channels for existing accounts that don't have them yet
    // (e.g. accounts that completed initial sync before watch channels were deployed)
    if (watchActive) {
      bootstrapWatchChannels().catch((err) => {
        console.error("[background-sync] Watch channel bootstrap failed:", err);
      });
    }

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
  }
  if (renewalInterval) {
    clearInterval(renewalInterval);
    renewalInterval = null;
  }
  console.log("[background-sync] Stopped");
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
 * Recover accounts stuck in "pending" or "syncing" state
 * This runs once on server startup to handle accounts that were interrupted
 * by a server crash or restart during initial sync
 */
async function recoverStuckAccounts(): Promise<void> {
  if (recoveryRan) {
    return; // Only run once per server lifetime
  }
  recoveryRan = true;

  if (!db) {
    console.log("[recovery] Database not configured, skipping");
    return;
  }

  try {
    const cutoffTime = new Date(Date.now() - STUCK_THRESHOLD_MS);

    // Find accounts that are stuck in pending/syncing state
    // Consider stuck if: status is pending/syncing AND (updatedAt is old OR updatedAt is null)
    const stuckAccounts = await db.query.accounts.findMany({
      where: or(
        eq(accounts.syncStatus, "pending"),
        eq(accounts.syncStatus, "syncing")
      ),
    });

    // Filter to only truly stuck accounts (updated more than 5 minutes ago)
    const reallyStuck = stuckAccounts.filter((account) => {
      if (!account.updatedAt) return true; // No timestamp = definitely stuck
      return account.updatedAt < cutoffTime;
    });

    if (reallyStuck.length === 0) {
      console.log("[recovery] No stuck accounts found");
      return;
    }

    console.log(
      `[recovery] Found ${reallyStuck.length} stuck accounts, attempting recovery`
    );

    for (const account of reallyStuck) {
      try {
        console.log(
          `[recovery] Retrying initial sync for ${account.email} (was: ${account.syncStatus})`
        );

        // Reset status to pending before retry
        await db
          .update(accounts)
          .set({
            syncStatus: "pending",
            syncError: null,
            updatedAt: new Date(),
          })
          .where(eq(accounts.id, account.id));

        // Retry initial sync (fire-and-forget, will update status on completion)
        performInitialSync(account.id).catch((error) => {
          console.error(
            `[recovery] Failed to recover ${account.email}:`,
            error
          );
        });

        // Stagger recovery attempts
        await sleep(ACCOUNT_STAGGER_MS);
      } catch (error) {
        console.error(
          `[recovery] Error recovering account ${account.email}:`,
          error
        );
      }
    }

    console.log(`[recovery] Recovery initiated for ${reallyStuck.length} accounts`);
  } catch (error) {
    console.error("[recovery] Recovery check failed:", error);
  }
}

/**
 * Create watch channels for all accounts that completed initial sync.
 * Clears existing channels first so channels always point to the current
 * WEBHOOK_BASE_URL (e.g. after an ngrok restart gives a new tunnel URL).
 * Old Google channels expire harmlessly on their own (~7 days).
 */
async function bootstrapWatchChannels(): Promise<void> {
  if (!db) return;

  try {
    // Clear stale channels — they may point to an old WEBHOOK_BASE_URL
    const deleted = await db.delete(watchChannels).returning({ id: watchChannels.id });
    if (deleted.length > 0) {
      console.log(`[watch] Cleared ${deleted.length} stale channel(s)`);
    }

    const completeAccounts = await db.query.accounts.findMany({
      where: eq(accounts.syncStatus, "complete"),
      columns: { id: true, email: true },
    });

    for (const account of completeAccounts) {
      console.log(`[watch] Bootstrapping channels for ${account.email}`);
      await createWatchChannelsForAccount(account.id);
      await sleep(ACCOUNT_STAGGER_MS);
    }
  } catch (error) {
    console.error("[watch] Bootstrap failed:", error);
  }
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

        // Push changed weeks to connected clients via WebSocket
        if (result.affectedWeekIds.length > 0) {
          notifyUser(account.userId, {
            type: "weeks_changed",
            weekIds: result.affectedWeekIds,
            source: "sync",
          });
        }

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

        // Sync provider contacts (once per day per account)
        if (shouldSyncContacts(account.id)) {
          syncProviderContacts(account.id).catch((err) => {
            console.error(
              `[background-sync] Contact sync failed for ${account.email}:`,
              err
            );
          });
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
): Promise<{ updated: number; deleted: number; affectedWeekIds: string[] }> {
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
    return { updated: 0, deleted: 0, affectedWeekIds: [] };
  }

  let totalUpdated = 0;
  let totalDeleted = 0;
  const allAffectedWeekIds = new Set<string>();

  // Get calendar colors and access roles for events
  const accessToken = await getAccessToken(accountId);
  const service = new GoogleCalendarService(accessToken);
  const calendarList = await service.fetchCalendarList();
  const colorMap = new Map(calendarList.map((c) => [c.id, c.color]));
  const accessRoleMap = new Map(calendarList.map((c) => [c.id, c.accessRole]));

  // Update stored accessRole for each calendar (may have changed)
  for (const cal of calendarList) {
    await db
      .update(calendarSyncState)
      .set({ accessRole: cal.accessRole ?? null })
      .where(
        and(
          eq(calendarSyncState.accountId, accountId),
          eq(calendarSyncState.calendarId, cal.id)
        )
      );
  }

  for (const calendar of calendars) {
    try {
      const color = colorMap.get(calendar.calendarId) || "#4285f4";
      const accessRole = accessRoleMap.get(calendar.calendarId);

      if (calendar.syncToken) {
        // Do incremental sync
        const result = await syncCalendarIncremental(
          accountId,
          calendar.calendarId,
          color,
          accessRole
        );
        totalUpdated += result.updated;
        totalDeleted += result.deleted;
        for (const weekId of result.affectedWeekIds) {
          allAffectedWeekIds.add(weekId);
        }
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
          timeMax,
          accessRole
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

  return { updated: totalUpdated, deleted: totalDeleted, affectedWeekIds: Array.from(allAffectedWeekIds) };
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
        accessRole: calendar.accessRole ?? null,
        lastSyncAt: new Date(),
      })
      .onConflictDoNothing();
  }
}
