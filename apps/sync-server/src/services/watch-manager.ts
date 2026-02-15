import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, watchChannels, calendarSyncState } from "../db/schema.js";
import { getAccessToken } from "./token-refresh.js";
import { getProvider } from "../providers/registry.js";
import type { Provider } from "@cathrin/shared-types";

// =============================================================================
// Watch Channel Manager
// =============================================================================
// Creates, renews, and stops push notification channels per calendar.
// Dispatches through the provider abstraction — each provider implements
// its own webhook protocol (Google: watch channels, Outlook: subscriptions).
// =============================================================================

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
 * Resolve the webhook address for a provider.
 * Each provider gets its own endpoint path.
 */
function getWebhookAddress(provider: Provider): string {
  // Future: /webhooks/outlook for Outlook subscriptions
  return `${WEBHOOK_BASE_URL}/webhooks/${provider === "google" ? "google-calendar" : provider}`;
}

/**
 * Create a watch channel for a specific calendar.
 * Dispatches through the provider's createWatch method.
 */
export async function createWatchChannel(
  accountId: string,
  calendarId: string
): Promise<void> {
  if (!db || !WEBHOOK_BASE_URL) return;

  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
    columns: { provider: true },
  });
  if (!account) return;

  const provider = getProvider(account.provider as Provider);
  if (!provider.createWatch) return; // Provider doesn't support webhooks

  const accessToken = await getAccessToken(accountId);
  const token = signChannelToken(accountId, calendarId);
  const address = getWebhookAddress(account.provider as Provider);

  try {
    const watchInfo = await provider.createWatch(accessToken, calendarId, address, { token });

    // Upsert — one channel per (account, calendar)
    await db
      .insert(watchChannels)
      .values({
        accountId,
        calendarId,
        channelId: watchInfo.channelId,
        resourceId: watchInfo.resourceId,
        expiration: watchInfo.expiration,
      })
      .onConflictDoUpdate({
        target: [watchChannels.accountId, watchChannels.calendarId],
        set: {
          channelId: watchInfo.channelId,
          resourceId: watchInfo.resourceId,
          expiration: watchInfo.expiration,
          createdAt: new Date(),
        },
      });

    console.log(
      `[watch] Created channel for ${calendarId} (expires: ${watchInfo.expiration.toISOString()})`
    );
  } catch (error) {
    const errorBody = error instanceof Error ? error.message : String(error);
    console.error(
      `[watch] Failed to create channel for ${calendarId}: ${errorBody}`
    );
  }
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
      // Stop old channel first (best effort — providers tolerate duplicates)
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
 * Stop a specific watch channel via the provider.
 */
export async function stopChannel(
  channelId: string,
  resourceId: string,
  accountId: string
): Promise<void> {
  try {
    const account = await db?.query.accounts.findFirst({
      where: eq(accounts.id, accountId),
      columns: { provider: true },
    });

    if (account) {
      const provider = getProvider(account.provider as Provider);
      if (provider.deleteWatch) {
        const accessToken = await getAccessToken(accountId);
        await provider.deleteWatch(accessToken, channelId, resourceId);
      }
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
 * Build the plaintext payload for a channel token.
 */
function buildTokenPayload(accountId: string, calendarId: string): string {
  return `accountId=${accountId}&calendarId=${encodeURIComponent(calendarId)}`;
}

/**
 * Get the HMAC signing key from the existing ENCRYPTION_KEY env var.
 */
function getSigningKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY environment variable is required");
  }
  return key;
}

/**
 * Create an HMAC-signed channel token.
 * Token format: "accountId=X&calendarId=Y&sig=<hex>"
 */
export function signChannelToken(accountId: string, calendarId: string): string {
  const payload = buildTokenPayload(accountId, calendarId);
  const sig = createHmac("sha256", getSigningKey())
    .update(payload)
    .digest("hex");
  return `${payload}&sig=${sig}`;
}

/**
 * Verify an HMAC-signed channel token and extract accountId + calendarId.
 * Returns null if the signature is missing, invalid, or tampered with.
 */
export function verifyChannelToken(
  token: string
): { accountId: string; calendarId: string } | null {
  try {
    const params = new URLSearchParams(token);
    const sig = params.get("sig");
    const accountId = params.get("accountId");
    const calendarId = params.get("calendarId");
    if (!sig || !accountId || !calendarId) return null;

    const payload = buildTokenPayload(accountId, calendarId);
    const expected = createHmac("sha256", getSigningKey())
      .update(payload)
      .digest("hex");

    // Timing-safe comparison to prevent timing attacks
    if (sig.length !== expected.length) return null;
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (!timingSafeEqual(a, b)) return null;

    return { accountId, calendarId };
  } catch {
    return null;
  }
}
