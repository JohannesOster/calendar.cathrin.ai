import { Hono } from "hono";
import { parseChannelToken, createWatchChannel } from "../services/watch-manager.js";
import { debouncedSync } from "../services/webhook-debouncer.js";
import { db } from "../db/index.js";
import { eq } from "drizzle-orm";
import { watchChannels, calendarSyncState } from "../db/schema.js";

// =============================================================================
// Outlook webhook types
// =============================================================================

interface OutlookNotification {
  subscriptionId: string;
  changeType: string;
  resource: string;
  resourceData?: { "@odata.type"?: string; id?: string };
  clientState?: string;
}

interface OutlookLifecycleNotification {
  subscriptionId: string;
  lifecycleEvent: "reauthorizationRequired" | "subscriptionRemoved" | "missed";
  resource: string;
  clientState?: string;
}

export const webhooksRoute = new Hono()
  // =========================================================================
  // Google Calendar
  // =========================================================================
  /**
   * Google Calendar push notification webhook.
   * Google sends POST with no body — only headers identifying the channel
   * and the type of change. We respond 200 immediately, then debounce
   * and trigger incremental sync.
   */
  .post("/google-calendar", async (c) => {
    const channelId = c.req.header("X-Goog-Channel-ID");
    const resourceState = c.req.header("X-Goog-Resource-State");
    const channelToken = c.req.header("X-Goog-Channel-Token");

    // Must respond 200 immediately — Google retries on 5xx
    if (!channelId || !channelToken) {
      return c.body(null, 200);
    }

    // "sync" is the initial confirmation when a channel is first created — ignore
    if (resourceState === "sync") {
      console.log(`[webhook] Received sync confirmation for channel ${channelId}`);
      return c.body(null, 200);
    }

    // Parse the token to get accountId and calendarId
    const parsed = parseChannelToken(channelToken);
    if (!parsed) {
      console.warn(`[webhook] Invalid channel token: ${channelToken}`);
      return c.body(null, 200);
    }

    console.log(
      `[webhook] Notification: ${resourceState} for calendar ${parsed.calendarId} (channel ${channelId})`
    );

    // Debounce and trigger incremental sync
    debouncedSync(parsed.accountId, parsed.calendarId);

    return c.body(null, 200);
  })
  // =========================================================================
  // Outlook Calendar
  // =========================================================================
  /**
   * Outlook subscription validation handshake.
   * When creating a subscription, Microsoft sends a validation POST with
   * ?validationToken=... and expects the token echoed back as plain text.
   */
  .post("/outlook", async (c) => {
    const validationToken = c.req.query("validationToken");
    if (validationToken) {
      return c.text(validationToken, 200);
    }

    // Normal change notification
    const body = await c.req.json().catch(() => null) as { value?: OutlookNotification[] } | null;
    if (!body?.value) {
      return c.body(null, 202);
    }

    for (const notification of body.value) {
      // Validate clientState to reject forged webhooks
      const parsed = parseChannelToken(notification.clientState || "");
      if (!parsed) {
        console.warn(`[webhook/outlook] Invalid clientState on notification`);
        continue;
      }

      console.log(
        `[webhook/outlook] ${notification.changeType} for ${parsed.calendarId} (sub ${notification.subscriptionId})`
      );

      debouncedSync(parsed.accountId, parsed.calendarId);
    }

    // Must respond 202 Accepted within 3 seconds
    return c.body(null, 202);
  })
  /**
   * Outlook lifecycle notification endpoint.
   * Handles: subscriptionRemoved, missed, reauthorizationRequired.
   */
  .post("/outlook/lifecycle", async (c) => {
    const validationToken = c.req.query("validationToken");
    if (validationToken) {
      return c.text(validationToken, 200);
    }

    const body = await c.req.json().catch(() => null) as { value?: OutlookLifecycleNotification[] } | null;
    if (!body?.value || !db) {
      return c.body(null, 202);
    }

    for (const notification of body.value) {
      const parsed = parseChannelToken(notification.clientState || "");
      if (!parsed) continue;

      const { accountId, calendarId } = parsed;

      switch (notification.lifecycleEvent) {
        case "missed":
          // Notifications were dropped — trigger full delta resync by
          // clearing the syncToken so next sync does a full pass
          console.log(`[webhook/outlook] Missed notification for ${calendarId}, clearing syncToken`);
          await db
            .update(calendarSyncState)
            .set({ syncToken: null })
            .where(eq(calendarSyncState.calendarId, calendarId));
          debouncedSync(accountId, calendarId);
          break;

        case "subscriptionRemoved":
          // Subscription was deleted by Microsoft — recreate it
          console.log(`[webhook/outlook] Subscription removed for ${calendarId}, recreating`);
          // Remove stale channel record
          await db
            .delete(watchChannels)
            .where(eq(watchChannels.channelId, notification.subscriptionId));
          // Recreate
          createWatchChannel(accountId, calendarId).catch((err) => {
            console.error(`[webhook/outlook] Failed to recreate subscription: ${err}`);
          });
          break;

        case "reauthorizationRequired":
          // Token expiring — the normal renewal cron handles this.
          // Log for visibility but no action needed here.
          console.log(`[webhook/outlook] Reauthorization required for sub ${notification.subscriptionId}`);
          break;
      }
    }

    return c.body(null, 202);
  });
