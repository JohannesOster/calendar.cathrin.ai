import { syncCalendarIncremental } from "./incremental-sync.js";
import { notifyUser } from "./ws-manager.js";
import { db } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import { accounts, calendarSyncState } from "../db/schema.js";
import { getAccessToken } from "./token-refresh.js";
import { GoogleCalendarService } from "./google-calendar.js";

// =============================================================================
// Webhook Debouncer
// =============================================================================
// Google sends multiple notifications in rapid succession for a single change
// (or when a user makes rapid edits). This debouncer groups them into a single
// sync operation per (accountId, calendarId) pair with a 3-second window.
// =============================================================================

const DEBOUNCE_MS = 3_000; // 3 seconds
const pendingSyncs = new Map<string, ReturnType<typeof setTimeout>>();

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

  // Get calendar color for events
  const accessToken = await getAccessToken(accountId);
  const service = new GoogleCalendarService(accessToken);
  const calendarList = await service.fetchCalendarList();
  const calendarInfo = calendarList.find((c) => c.id === calendarId);
  const color = calendarInfo?.color || "#4285f4";
  const accessRole = calendarInfo?.accessRole;

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
