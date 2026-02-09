import { eq, and, inArray, lte, gte } from "drizzle-orm";
import { db } from "../db/index.js";
import { serverEvents, fetchedWeeks } from "../db/schema.js";
import { getAccessToken } from "./token-refresh.js";
import { GoogleCalendarService } from "./google-calendar.js";
import { getDateBoundsForWeeks } from "../lib/week-utils.js";

// Weeks fetched more than this ago are re-fetched from Google on client request
const SERVER_STALE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Ensure all weeks in the given range are fetched for a specific calendar.
 * Fetches missing OR stale weeks from Google on-demand.
 */
export async function ensureWeeksFetched(
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

  // Only consider weeks fresh if fetched within the staleness threshold
  const now = Date.now();
  const freshSet = new Set(
    existing
      .filter((w) => now - w.fetchedAt.getTime() < SERVER_STALE_THRESHOLD_MS)
      .map((w) => w.weekId)
  );
  const weeksToFetch = weeksNeeded.filter((w) => !freshSet.has(w));

  if (weeksToFetch.length === 0) return;

  console.log(
    `[calendar-sync] On-demand fetch for ${weeksToFetch.length} weeks: ${weeksToFetch.join(", ")}`
  );

  try {
    const { start, end } = getDateBoundsForWeeks(weeksToFetch);

    const accessToken = await getAccessToken(accountId);
    const service = new GoogleCalendarService(accessToken);
    const events = await service.fetchEvents(
      calendarId,
      start.toISOString(),
      end.toISOString(),
      calendarColor
    );

    console.log(
      `[calendar-sync] Fetched ${events.length} events for calendar ${calendarId}`
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
          location: event.location,
          description: event.description,
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
            location: event.location,
            description: event.description,
            updatedAt: new Date(),
          },
        });
    }

    // Remove events in the fetched range that Google no longer returns
    const fetchedEventIds = new Set(events.map((e) => e.id));
    const existingInRange = await db.query.serverEvents.findMany({
      where: and(
        eq(serverEvents.accountId, accountId),
        eq(serverEvents.calendarId, calendarId),
        lte(serverEvents.start, end),
        gte(serverEvents.end, start)
      ),
      columns: { id: true, googleEventId: true },
    });

    for (const existing of existingInRange) {
      if (!fetchedEventIds.has(existing.googleEventId)) {
        await db.delete(serverEvents).where(eq(serverEvents.id, existing.id));
      }
    }

    // Mark weeks as fetched
    for (const weekId of weeksToFetch) {
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
      `[calendar-sync] On-demand fetch complete for ${weeksToFetch.length} weeks`
    );
  } catch (error) {
    // Log but don't throw - we still want to return cached data
    console.error(
      `[calendar-sync] Failed to fetch missing weeks for calendar ${calendarId}:`,
      error
    );
  }
}

export type CalendarInfo = {
  accountId: string;
  calendarId: string;
  color: string;
};

/**
 * Get calendars to check for missing weeks from existing events and fetchedWeeks.
 */
export async function getCalendarsToCheck(
  accountIds: string[],
  calendarIds?: string[]
): Promise<CalendarInfo[]> {
  if (!db) return [];

  const calendarsToCheck: CalendarInfo[] = [];
  const seen = new Set<string>();

  if (calendarIds && calendarIds.length > 0) {
    // Get calendars from existing events
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

    // Check fetchedWeeks for calendars without events
    const calendarIdsWithEvents = new Set(calendarsToCheck.map((c) => c.calendarId));
    const missingCalendarIds = calendarIds.filter((id) => !calendarIdsWithEvents.has(id));

    if (missingCalendarIds.length > 0) {
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
  } else {
    // No specific calendars - get all known calendars
    const existingEvents = await db.query.serverEvents.findMany({
      where: inArray(serverEvents.accountId, accountIds),
      columns: {
        accountId: true,
        calendarId: true,
        color: true,
      },
    });

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

    // Also check fetchedWeeks for calendars with no events
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

  return calendarsToCheck;
}
