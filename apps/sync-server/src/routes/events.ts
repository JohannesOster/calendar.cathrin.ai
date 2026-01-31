import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, lte, gte, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, serverEvents } from "../db/schema.js";
import { authMiddleware } from "../middlewares/auth.js";
import type { ApiCalendarEvent } from "@cathrin/shared-types";

const querySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  calendarIds: z.union([z.string(), z.array(z.string())]).optional(),
});

export const eventsRoute = new Hono()
  .use("*", authMiddleware)
  .get("/", zValidator("query", querySchema), async (c) => {
    if (!db) {
      return c.json({ error: "Database not configured" }, 500);
    }

    const userId = c.get("userId");
    const { from, to, calendarIds: rawCalendarIds } = c.req.valid("query");

    // Normalize calendarIds to array
    const calendarIds = rawCalendarIds
      ? Array.isArray(rawCalendarIds)
        ? rawCalendarIds
        : [rawCalendarIds]
      : undefined;

    // Get user's account IDs
    const userAccounts = await db.query.accounts.findMany({
      where: eq(accounts.userId, userId),
      columns: { id: true },
    });

    const accountIds = userAccounts.map((a) => a.id);

    if (accountIds.length === 0) {
      return c.json([]);
    }

    // Parse dates for comparison
    const fromDate = new Date(from);
    const toDate = new Date(to);

    // Build query - events overlap with range if: start <= to AND end >= from
    let events;
    if (calendarIds && calendarIds.length > 0) {
      events = await db.query.serverEvents.findMany({
        where: and(
          inArray(serverEvents.accountId, accountIds),
          inArray(serverEvents.calendarId, calendarIds),
          lte(serverEvents.start, toDate),
          gte(serverEvents.end, fromDate)
        ),
        orderBy: (events, { asc }) => [asc(events.start)],
      });
    } else {
      events = await db.query.serverEvents.findMany({
        where: and(
          inArray(serverEvents.accountId, accountIds),
          lte(serverEvents.start, toDate),
          gte(serverEvents.end, fromDate)
        ),
        orderBy: (events, { asc }) => [asc(events.start)],
      });
    }

    // Map to API format
    const apiEvents: ApiCalendarEvent[] = events.map((event) => ({
      id: event.googleEventId,
      calendarId: event.calendarId,
      title: event.title,
      start: event.start.toISOString(),
      end: event.end.toISOString(),
      isAllDay: event.isAllDay ?? false,
      color: event.color || "#4285f4",
      provider: "google",
    }));

    return c.json(apiEvents);
  });
