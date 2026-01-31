import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, lte, gte, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, serverEvents, fetchedWeeks } from "../db/schema.js";
import { authMiddleware } from "../middlewares/auth.js";
import { getAccessToken } from "../services/token-refresh.js";
import { GoogleCalendarService } from "../services/google-calendar.js";
import {
  getWeeksInRange,
  getDateBoundsForWeeks,
} from "../lib/week-utils.js";
import type { ApiCalendarEvent } from "@cathrin/shared-types";

const querySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  calendarIds: z.union([z.string(), z.array(z.string())]).optional(),
});

/**
 * Ensure all weeks in the given range are fetched for a specific calendar
 * Fetches missing weeks from Google on-demand
 */
async function ensureWeeksFetched(
  accountId: string,
  calendarId: string,
  calendarColor: string,
  weeksNeeded: string[]
): Promise<void> {
  if (!db) return;

  // Check which weeks are already fetched
  const existing = await db.query.fetchedWeeks.findMany({
    where: and(
      eq(fetchedWeeks.accountId, accountId),
      eq(fetchedWeeks.calendarId, calendarId),
      inArray(fetchedWeeks.weekId, weeksNeeded)
    ),
  });

  const existingSet = new Set(existing.map((w) => w.weekId));
  const missingWeeks = weeksNeeded.filter((w) => !existingSet.has(w));

  if (missingWeeks.length === 0) return;

  console.log(
    `[events] On-demand fetch for ${missingWeeks.length} weeks: ${missingWeeks.join(", ")}`
  );

  try {
    // Convert weeks to date range
    const { start, end } = getDateBoundsForWeeks(missingWeeks);

    // Fetch from Google
    const accessToken = await getAccessToken(accountId);
    const service = new GoogleCalendarService(accessToken);
    const events = await service.fetchEvents(
      calendarId,
      start.toISOString(),
      end.toISOString(),
      calendarColor
    );

    console.log(
      `[events] Fetched ${events.length} events for calendar ${calendarId}`
    );

    // Store events
    for (const event of events) {
      await db
        .insert(serverEvents)
        .values({
          accountId,
          calendarId,
          googleEventId: event.id,
          title: event.title,
          start: new Date(event.start),
          end: new Date(event.end),
          isAllDay: event.isAllDay,
          color: event.color,
          status: "confirmed",
        })
        .onConflictDoUpdate({
          target: [serverEvents.accountId, serverEvents.googleEventId],
          set: {
            title: event.title,
            start: new Date(event.start),
            end: new Date(event.end),
            isAllDay: event.isAllDay,
            color: event.color,
            updatedAt: new Date(),
          },
        });
    }

    // Mark weeks as fetched
    for (const weekId of missingWeeks) {
      await db
        .insert(fetchedWeeks)
        .values({
          accountId,
          calendarId,
          weekId,
        })
        .onConflictDoUpdate({
          target: [
            fetchedWeeks.accountId,
            fetchedWeeks.calendarId,
            fetchedWeeks.weekId,
          ],
          set: { fetchedAt: new Date() },
        });
    }

    console.log(
      `[events] On-demand fetch complete for ${missingWeeks.length} weeks`
    );
  } catch (error) {
    // Log but don't throw - we still want to return cached data
    console.error(
      `[events] Failed to fetch missing weeks for calendar ${calendarId}:`,
      error
    );
  }
}

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

    // Get user's accounts with their info
    const userAccounts = await db.query.accounts.findMany({
      where: eq(accounts.userId, userId),
    });

    if (userAccounts.length === 0) {
      return c.json([]);
    }

    const accountIds = userAccounts.map((a) => a.id);

    // Parse dates for comparison
    const fromDate = new Date(from);
    const toDate = new Date(to);

    // Calculate which weeks are needed
    const weeksNeeded = getWeeksInRange(fromDate, toDate);

    // Get unique calendar IDs from existing events if not specified
    // We need to know which calendars to check for missing weeks
    let calendarsToCheck: { accountId: string; calendarId: string; color: string }[] = [];

    if (calendarIds && calendarIds.length > 0) {
      // For each requested calendar, we need to find its account and color
      // Get existing events to determine account mapping and colors
      const existingEvents = await db.query.serverEvents.findMany({
        where: and(
          inArray(serverEvents.accountId, accountIds),
          inArray(serverEvents.calendarId, calendarIds)
        ),
        columns: {
          accountId: true,
          calendarId: true,
          color: true,
        },
      });

      // Build unique calendar list with account mapping
      const seen = new Set<string>();
      for (const event of existingEvents) {
        const key = `${event.accountId}:${event.calendarId}`;
        if (!seen.has(key)) {
          seen.add(key);
          calendarsToCheck.push({
            accountId: event.accountId,
            calendarId: event.calendarId,
            color: event.color || "#4285f4",
          });
        }
      }

      // For calendars we haven't seen events from yet, we need to try fetching
      // Check fetchedWeeks to find account mappings for calendars without events
      const calendarIdsWithEvents = new Set(calendarsToCheck.map((c) => c.calendarId));
      const missingCalendarIds = calendarIds.filter((id) => !calendarIdsWithEvents.has(id));

      if (missingCalendarIds.length > 0) {
        // Check if we have any fetched_weeks entries for these calendars
        const weekEntries = await db.query.fetchedWeeks.findMany({
          where: and(
            inArray(fetchedWeeks.accountId, accountIds),
            inArray(fetchedWeeks.calendarId, missingCalendarIds)
          ),
          columns: {
            accountId: true,
            calendarId: true,
          },
        });

        const seenFromWeeks = new Set<string>();
        for (const entry of weekEntries) {
          const key = `${entry.accountId}:${entry.calendarId}`;
          if (!seenFromWeeks.has(key)) {
            seenFromWeeks.add(key);
            calendarsToCheck.push({
              accountId: entry.accountId,
              calendarId: entry.calendarId,
              color: "#4285f4", // Default color for calendars we haven't seen events from
            });
          }
        }
      }
    } else {
      // No specific calendars requested - get all calendars we know about
      // from either events or fetched_weeks
      const existingEvents = await db.query.serverEvents.findMany({
        where: inArray(serverEvents.accountId, accountIds),
        columns: {
          accountId: true,
          calendarId: true,
          color: true,
        },
      });

      const seen = new Set<string>();
      for (const event of existingEvents) {
        const key = `${event.accountId}:${event.calendarId}`;
        if (!seen.has(key)) {
          seen.add(key);
          calendarsToCheck.push({
            accountId: event.accountId,
            calendarId: event.calendarId,
            color: event.color || "#4285f4",
          });
        }
      }

      // Also check fetchedWeeks for calendars that may have no events
      const weekEntries = await db.query.fetchedWeeks.findMany({
        where: inArray(fetchedWeeks.accountId, accountIds),
        columns: {
          accountId: true,
          calendarId: true,
        },
      });

      for (const entry of weekEntries) {
        const key = `${entry.accountId}:${entry.calendarId}`;
        if (!seen.has(key)) {
          seen.add(key);
          calendarsToCheck.push({
            accountId: entry.accountId,
            calendarId: entry.calendarId,
            color: "#4285f4",
          });
        }
      }
    }

    // Ensure weeks are fetched for all relevant calendars
    // Process in parallel for each calendar
    await Promise.all(
      calendarsToCheck.map((cal) =>
        ensureWeeksFetched(cal.accountId, cal.calendarId, cal.color, weeksNeeded)
      )
    );

    // Now query events - same as before
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
