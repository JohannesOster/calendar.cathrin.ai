import { eq, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { watchChannels, calendarSyncState } from "../db/schema.js";
import { getAccessToken } from "./token-refresh.js";

// =============================================================================
// Google Calendar Watch Channel Manager
// =============================================================================
// Creates, renews, and stops push notification channels per calendar.
// Google sends webhook POSTs when events change — we trigger incremental sync.
// Channels expire after ~7 days and must be proactively renewed.
// =============================================================================

const CHANNEL_TTL_SECONDS = 604_800; // 7 days (Google default/max reliable)
const RENEW_BEFORE_MS = 2 * 24 * 60 * 60 * 1000; // Renew 2 days before expiry

const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL;

/**
 * Check if watch channels are enabled (WEBHOOK_BASE_URL is configured).
 * Falls back to polling-only mode when not set (e.g., local development).
 */
export function isWatchEnabled(): boolean {
  return !!WEBHOOK_BASE_URL;
}

/**
 * Create a watch channel for a specific calendar.
 * Google will POST to our webhook when events in this calendar change.
 */
export async function createWatchChannel(
  accountId: string,
  calendarId: string
): Promise<void> {
  if (!db || !WEBHOOK_BASE_URL) return;

  const channelId = crypto.randomUUID();
  const token = `accountId=${accountId}&calendarId=${encodeURIComponent(calendarId)}`;
  const address = `${WEBHOOK_BASE_URL}/webhooks/google-calendar`;

  const accessToken = await getAccessToken(accountId);

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/watch`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address,
        token,
        params: { ttl: String(CHANNEL_TTL_SECONDS) },
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    console.error(
      `[watch] Failed to create channel for ${calendarId}: ${response.status} ${errorBody}`
    );
    return;
  }

  const data = (await response.json()) as {
    id: string;
    resourceId: string;
    expiration: string; // ms since epoch as string
  };

  const expiration = new Date(Number(data.expiration));

  // Upsert — one channel per (account, calendar)
  await db
    .insert(watchChannels)
    .values({
      accountId,
      calendarId,
      channelId: data.id,
      resourceId: data.resourceId,
      expiration,
    })
    .onConflictDoUpdate({
      target: [watchChannels.accountId, watchChannels.calendarId],
      set: {
        channelId: data.id,
        resourceId: data.resourceId,
        expiration,
        createdAt: new Date(),
      },
    });

  console.log(
    `[watch] Created channel for ${calendarId} (expires: ${expiration.toISOString()})`
  );
}

/**
 * Create watch channels for all calendars of an account.
 * Called after initial sync completes.
 */
export async function createWatchChannelsForAccount(
  accountId: string
): Promise<void> {
  if (!db || !WEBHOOK_BASE_URL) return;

  const calendars = await db.query.calendarSyncState.findMany({
    where: eq(calendarSyncState.accountId, accountId),
  });

  // Sequential is fine — runs once per account at startup/initial-sync, not on a hot path
  for (const cal of calendars) {
    try {
      await createWatchChannel(accountId, cal.calendarId);
    } catch (error) {
      console.error(
        `[watch] Failed to create channel for ${cal.calendarId}:`,
        error
      );
      // Continue with other calendars
    }
  }
}

/**
 * Renew channels that are expiring within the renewal window.
 * Creates a new channel (with new ID) and replaces the old one in DB.
 * Google allows overlapping channels during transition.
 */
export async function renewExpiringChannels(): Promise<void> {
  if (!db || !WEBHOOK_BASE_URL) return;

  const renewBefore = new Date(Date.now() + RENEW_BEFORE_MS);

  const expiringChannels = await db.query.watchChannels.findMany({
    where: lt(watchChannels.expiration, renewBefore),
  });

  if (expiringChannels.length === 0) return;

  console.log(
    `[watch] Renewing ${expiringChannels.length} expiring channels`
  );

  for (const channel of expiringChannels) {
    try {
      // Stop old channel first (best effort — Google tolerates duplicates)
      await stopChannel(channel.channelId, channel.resourceId, channel.accountId);

      // Create new channel
      await createWatchChannel(channel.accountId, channel.calendarId);
    } catch (error) {
      console.error(
        `[watch] Failed to renew channel for ${channel.calendarId}:`,
        error
      );
    }
  }
}

/**
 * Stop a specific watch channel via Google API.
 */
export async function stopChannel(
  channelId: string,
  resourceId: string,
  accountId: string
): Promise<void> {
  try {
    const accessToken = await getAccessToken(accountId);

    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/channels/stop",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: channelId, resourceId }),
      }
    );

    if (!response.ok && response.status !== 404) {
      console.warn(
        `[watch] Failed to stop channel ${channelId}: ${response.status}`
      );
    }
  } catch (error) {
    console.warn(`[watch] Error stopping channel ${channelId}:`, error);
  }

  // Remove from DB regardless (channel may have already expired)
  if (db) {
    await db
      .delete(watchChannels)
      .where(eq(watchChannels.channelId, channelId));
  }
}

/**
 * Stop and clean up all watch channels for an account.
 * Called when account is disconnected.
 */
export async function cleanupAccountChannels(
  accountId: string
): Promise<void> {
  if (!db) return;

  const channels = await db.query.watchChannels.findMany({
    where: eq(watchChannels.accountId, accountId),
  });

  for (const channel of channels) {
    await stopChannel(channel.channelId, channel.resourceId, accountId);
  }
}

/**
 * Look up the accountId and calendarId from a channel's token string.
 * Token format: "accountId=X&calendarId=Y"
 */
export function parseChannelToken(
  token: string
): { accountId: string; calendarId: string } | null {
  try {
    const params = new URLSearchParams(token);
    const accountId = params.get("accountId");
    const calendarId = params.get("calendarId");
    if (!accountId || !calendarId) return null;
    return { accountId, calendarId };
  } catch {
    return null;
  }
}
