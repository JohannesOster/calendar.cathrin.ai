import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, lte, gte, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, serverEvents, fetchedWeeks } from "../db/schema.js";
import { authMiddleware } from "../middlewares/auth.js";
import { getWeeksInRange } from "../lib/week-utils.js";
import {
  ensureWeeksFetched,
  getCalendarsToCheck,
} from "../services/calendar-sync.js";
import { getAccessToken } from "../services/token-refresh.js";
import {
  GoogleCalendarService,
  GoogleApiError,
  TokenExpiredError,
} from "../services/google-calendar.js";
import type { ApiCalendarEvent } from "@cathrin/shared-types";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

async function createEvent(
  c: Context,
  accountId: string,
  calendarId: string,
  title: string,
  start: string,
  end: string,
  isAllDay?: boolean,
  calendarColor?: string | null,
  location?: string,
  description?: string
) {
  try {
    const accessToken = await getAccessToken(accountId);
    const service = new GoogleCalendarService(accessToken);

    const googleEvent = await service.insertEvent(calendarId, {
      summary: title,
      start: isAllDay ? { date: start.slice(0, 10) } : { dateTime: start },
      end: isAllDay ? { date: end.slice(0, 10) } : { dateTime: end },
      location,
      description,
    });

    const color = calendarColor || "#4285f4";
    const eventStart = isAllDay
      ? new Date(googleEvent.start.date!)
      : new Date(googleEvent.start.dateTime!);
    const eventEnd = isAllDay
      ? new Date(googleEvent.end.date!)
      : new Date(googleEvent.end.dateTime!);

    // Store in local cache
    await db!
      .insert(serverEvents)
      .values({
        accountId,
        calendarId,
        googleEventId: googleEvent.id,
        title: googleEvent.summary || title,
        start: eventStart,
        end: eventEnd,
        isAllDay: isAllDay ?? false,
        color,
        location: googleEvent.location || location,
        description: googleEvent.description || description,
        status: "confirmed",
      })
      .onConflictDoUpdate({
        target: [serverEvents.accountId, serverEvents.googleEventId],
        set: {
          title: googleEvent.summary || title,
          start: eventStart,
          end: eventEnd,
          isAllDay: isAllDay ?? false,
          color,
          location: googleEvent.location || location,
          description: googleEvent.description || description,
          updatedAt: new Date(),
        },
      });

    const apiEvent: ApiCalendarEvent = {
      id: googleEvent.id,
      calendarId,
      title: googleEvent.summary || title,
      start: eventStart.toISOString(),
      end: eventEnd.toISOString(),
      isAllDay: isAllDay ?? false,
      color,
      provider: "google",
      location: googleEvent.location || location || undefined,
      description: googleEvent.description || description || undefined,
    };

    return c.json(apiEvent, 201);
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      return c.json({ error: "Token expired - re-authorization required" }, 401);
    }
    if (error instanceof GoogleApiError) {
      return c.json({ error: error.message }, error.statusCode as ContentfulStatusCode);
    }
    throw error;
  }
}

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
      location: event.location || undefined,
      description: event.description || undefined,
    }));

    return c.json(apiEvents);
  })
  .post(
    "/",
    zValidator(
      "json",
      z.object({
        calendarId: z.string().min(1),
        title: z.string().min(1),
        start: z.union([z.string().datetime(), z.string().date()]),
        end: z.union([z.string().datetime(), z.string().date()]),
        isAllDay: z.boolean().optional(),
        location: z.string().optional(),
        description: z.string().optional(),
      })
    ),
    async (c) => {
      if (!db) {
        return c.json({ error: "Database not configured" }, 500);
      }

      const userId = c.get("userId");
      const { calendarId, title, start, end, isAllDay, location, description } = c.req.valid("json");

      // Find the account that owns this calendar
      const userAccounts = await db.query.accounts.findMany({
        where: eq(accounts.userId, userId),
      });

      if (userAccounts.length === 0) {
        return c.json({ error: "No accounts found" }, 404);
      }

      // We need to find which account owns the calendarId.
      // Check serverEvents or fetchedWeeks for a match.
      const existingEvent = await db.query.serverEvents.findFirst({
        where: and(
          inArray(
            serverEvents.accountId,
            userAccounts.map((a) => a.id)
          ),
          eq(serverEvents.calendarId, calendarId)
        ),
        columns: { accountId: true, color: true },
      });

      const accountId = existingEvent?.accountId;

      if (!accountId) {
        // Calendar might be empty — check fetchedWeeks
        const weekEntry = await db.query.fetchedWeeks.findFirst({
          where: and(
            inArray(
              fetchedWeeks.accountId,
              userAccounts.map((a) => a.id)
            ),
            eq(fetchedWeeks.calendarId, calendarId)
          ),
          columns: { accountId: true },
        });

        if (!weekEntry) {
          return c.json({ error: "Calendar not found" }, 404);
        }

        return await createEvent(c, weekEntry.accountId, calendarId, title, start, end, isAllDay, null, location, description);
      }

      return await createEvent(c, accountId, calendarId, title, start, end, isAllDay, existingEvent?.color, location, description);
    }
  )
  .delete("/:eventId", async (c) => {
    if (!db) {
      return c.json({ error: "Database not configured" }, 500);
    }

    const userId = c.get("userId");
    const googleEventId = c.req.param("eventId");

    // Find the event in our cache to get accountId and calendarId
    const userAccounts = await db.query.accounts.findMany({
      where: eq(accounts.userId, userId),
      columns: { id: true },
    });

    if (userAccounts.length === 0) {
      return c.json({ error: "No accounts found" }, 404);
    }

    const accountIds = userAccounts.map((a) => a.id);

    const event = await db.query.serverEvents.findFirst({
      where: and(
        inArray(serverEvents.accountId, accountIds),
        eq(serverEvents.googleEventId, googleEventId)
      ),
    });

    if (!event) {
      return c.json({ error: "Event not found" }, 404);
    }

    try {
      const accessToken = await getAccessToken(event.accountId);
      const service = new GoogleCalendarService(accessToken);
      await service.deleteEvent(event.calendarId, googleEventId);
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        return c.json({ error: "Token expired - re-authorization required" }, 401);
      }
      if (error instanceof GoogleApiError) {
        return c.json({ error: error.message }, error.statusCode as ContentfulStatusCode);
      }
      throw error;
    }

    // Remove from local cache
    await db
      .delete(serverEvents)
      .where(eq(serverEvents.id, event.id));

    return c.json({ success: true });
  });
