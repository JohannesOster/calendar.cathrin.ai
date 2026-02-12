import { Hono } from "hono";
import { parseChannelToken } from "../services/watch-manager.js";
import { debouncedSync } from "../services/webhook-debouncer.js";

export const webhooksRoute = new Hono()
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
  });
