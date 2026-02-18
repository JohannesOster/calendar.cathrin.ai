import { syncCalendarIncremental } from "./incremental-sync.js";
import { notifyUser } from "./ws-manager.js";
import { db } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import { accounts, calendarSyncState, serverEvents } from "../db/schema.js";

// =============================================================================
// Webhook Debouncer
// =============================================================================
// Google sends multiple notifications in rapid succession for a single change
// (or when a user makes rapid edits). This debouncer groups them into a single
// sync operation per (accountId, calendarId) pair with a 1-second window.
// =============================================================================

const DEBOUNCE_MS = 1_000; // 1 second
const MUTATION_COOLDOWN_MS = 5_000; // Skip webhook sync for 5s after a local mutation
const pendingSyncs = new Map<string, ReturnType<typeof setTimeout>>();
const recentMutations = new Map<string, number>(); // calendarId → timestamp

/**
 * Record that a mutation was performed on a calendar.
 * Webhook-triggered syncs will be skipped for a short window to avoid
 * re-fetching stale data that Google hasn't propagated yet.
 */
export function recordMutation(calendarId: string): void {
  recentMutations.set(calendarId, Date.now());
}

/**
 * Schedule a debounced sync for a calendar.
 * If called multiple times within the debounce window, only the last
 * invocation triggers the actual sync.
 */
export function debouncedSync(
  accountId: string,
  calendarId: string
): void {
  const key = `${accountId}:${calendarId}`;

  // Clear any pending sync for this calendar
  const existing = pendingSyncs.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  // Schedule sync after debounce window
  pendingSyncs.set(
    key,
    setTimeout(() => {
      pendingSyncs.delete(key);
      performWebhookSync(accountId, calendarId).catch((error) => {
        console.error(
          `[webhook] Debounced sync failed for ${calendarId}:`,
          error
        );
      });
    }, DEBOUNCE_MS)
  );
}

/**
 * Perform incremental sync triggered by a webhook notification.
 * After syncing, push changed weeks to connected clients via WebSocket.
 */
async function performWebhookSync(
  accountId: string,
  calendarId: string
): Promise<void> {
  if (!db) return;

  // Skip if a local mutation happened recently — the provider may not have
  // propagated the change yet, so an incremental sync would return stale data.
  const lastMutation = recentMutations.get(calendarId) ?? 0;
  if (Date.now() - lastMutation < MUTATION_COOLDOWN_MS) {
    console.log(`[webhook] Skipping sync for ${calendarId} — recent mutation (${Date.now() - lastMutation}ms ago)`);
    return;
  }

  // Verify the calendar has a syncToken (otherwise we can't do incremental sync)
  const state = await db.query.calendarSyncState.findFirst({
    where: and(
      eq(calendarSyncState.accountId, accountId),
      eq(calendarSyncState.calendarId, calendarId)
    ),
  });

  if (!state?.syncToken) {
    console.warn(
      `[webhook] No syncToken for ${calendarId}, skipping webhook sync`
    );
    return;
  }

  // Read color from an existing event — avoids a Google API round-trip
  const existingEvent = await db.query.serverEvents.findFirst({
    where: and(
      eq(serverEvents.accountId, accountId),
      eq(serverEvents.calendarId, calendarId)
    ),
    columns: { color: true },
  });
  const color = existingEvent?.color || "#4285f4";
  const accessRole = state.accessRole ?? undefined;

  console.log(`[webhook] Running incremental sync for ${calendarId}`);

  const result = await syncCalendarIncremental(
    accountId,
    calendarId,
    color,
    accessRole
  );

  if (result.affectedWeekIds.length > 0) {
    // Look up userId for this account to push via WebSocket
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, accountId),
      columns: { userId: true },
    });

    if (account) {
      notifyUser(account.userId, {
        type: "weeks_changed",
        weekIds: result.affectedWeekIds,
        source: "sync",
      });
    }
  }

  console.log(
    `[webhook] Sync complete for ${calendarId}: ${result.updated} updated, ${result.deleted} deleted`
  );
}
