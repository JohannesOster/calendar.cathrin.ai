import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, lte, gte, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, serverEvents } from "../db/schema.js";
import { authMiddleware } from "../middlewares/auth.js";
import { getWeeksInRange } from "../lib/week-utils.js";
import {
  ensureWeeksFetched,
  getCalendarsToCheck,
} from "../services/calendar-sync.js";
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

    // Get user's accounts
    const userAccounts = await db.query.accounts.findMany({
      where: eq(accounts.userId, userId),
    });

    if (userAccounts.length === 0) {
      return c.json([]);
    }

    const accountIds = userAccounts.map((a) => a.id);
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const weeksNeeded = getWeeksInRange(fromDate, toDate);

    // Get calendars to check for missing weeks
    const calendarsToCheck = await getCalendarsToCheck(accountIds, calendarIds);

    // Ensure weeks are fetched for all relevant calendars (in parallel)
    await Promise.all(
      calendarsToCheck.map((cal) =>
        ensureWeeksFetched(cal.accountId, cal.calendarId, cal.color, weeksNeeded)
      )
    );

    // Query events
    const events = calendarIds && calendarIds.length > 0
      ? await db.query.serverEvents.findMany({
          where: and(
            inArray(serverEvents.accountId, accountIds),
            inArray(serverEvents.calendarId, calendarIds),
            lte(serverEvents.start, toDate),
            gte(serverEvents.end, fromDate)
          ),
          orderBy: (events, { asc }) => [asc(events.start)],
        })
      : await db.query.serverEvents.findMany({
          where: and(
            inArray(serverEvents.accountId, accountIds),
            lte(serverEvents.start, toDate),
            gte(serverEvents.end, fromDate)
          ),
          orderBy: (events, { asc }) => [asc(events.start)],
        });

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
