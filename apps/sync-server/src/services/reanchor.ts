import { eq, and, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  accounts,
  calendarSyncState,
  fetchedWeeks,
} from "../db/schema.js";
import { getAccessToken } from "./token-refresh.js";
import { getProvider } from "../providers/registry.js";
import type { Provider } from "@cathrin/shared-types";
import {
  getWeekId,
  getWeekBounds,
  getWeeksInRange,
  getWeekDistance,
  addWeeks,
} from "../lib/week-utils.js";
import { upsertServerEvents } from "./event-storage.js";

// Reanchoring configuration
const EDGE_THRESHOLD_WEEKS = 8; // ~2 months - trigger reanchoring when this close to edge
const EXTENSION_WEEKS = 26; // 6 months - how much to extend when reanchoring
const REANCHOR_INTERVAL_HOURS = 4; // Check every 4 hours per account

/**
 * Check if reanchoring should run for an account
 * Returns true if it's been more than 24 hours since last reanchor
 */
export function shouldCheckReanchor(lastReanchorAt: Date | null): boolean {
  if (!lastReanchorAt) return true;
  const hoursSince =
    (Date.now() - lastReanchorAt.getTime()) / (1000 * 60 * 60);
  return hoursSince >= REANCHOR_INTERVAL_HOURS;
}

/**
 * Get the min and max fetched weeks for a calendar
 */
async function getFetchedBounds(
  accountId: string,
  calendarId: string
): Promise<{ minWeek: string | null; maxWeek: string | null }> {
  if (!db) {
    return { minWeek: null, maxWeek: null };
  }

  // Use SQL aggregate to efficiently get min/max
  const result = await db
    .select({
      minWeek: sql<string>`MIN(${fetchedWeeks.weekId})`,
      maxWeek: sql<string>`MAX(${fetchedWeeks.weekId})`,
    })
    .from(fetchedWeeks)
    .where(
      and(
        eq(fetchedWeeks.accountId, accountId),
        eq(fetchedWeeks.calendarId, calendarId)
      )
    );

  return {
    minWeek: result[0]?.minWeek || null,
    maxWeek: result[0]?.maxWeek || null,
  };
}

/**
 * Fetch events for a week range and store them
 */
async function fetchWeekRange(
  accountId: string,
  calendarId: string,
  calendarColor: string,
  fromWeek: string,
  toWeek: string
): Promise<number> {
  if (!db) return 0;

  const { start } = getWeekBounds(fromWeek);
  const { end } = getWeekBounds(toWeek);

  const account = await db!.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
    columns: { provider: true, email: true },
  });
  if (!account) return 0;

  const provider = getProvider(account.provider as Provider);
  const accessToken = await getAccessToken(accountId);

  const { events } = await provider.getEvents(accessToken, calendarId, {
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    calendarColor,
    accountEmail: account.email,
  });

  // Store events
  await upsertServerEvents(db, events, accountId, calendarId);

  // Mark weeks as fetched
  const weeksInRange = getWeeksInRange(start, end);
  for (const weekId of weeksInRange) {
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

  return events.length;
}

/**
 * Check and perform reanchoring for a single account
 * Extends the fetched window if "today" is approaching an edge
 */
export async function checkAndReanchor(accountId: string): Promise<{
  extended: boolean;
  futureWeeks: number;
  pastWeeks: number;
  eventsAdded: number;
}> {
  if (!db) {
    return { extended: false, futureWeeks: 0, pastWeeks: 0, eventsAdded: 0 };
  }

  const currentWeek = getWeekId(new Date());
  let totalFutureWeeks = 0;
  let totalPastWeeks = 0;
  let totalEventsAdded = 0;

  // Get all calendars for this account
  const calendars = await db.query.calendarSyncState.findMany({
    where: eq(calendarSyncState.accountId, accountId),
  });

  if (calendars.length === 0) {
    return { extended: false, futureWeeks: 0, pastWeeks: 0, eventsAdded: 0 };
  }

  // Get calendar colors for events
  const account = await db!.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
    columns: { provider: true },
  });
  if (!account) {
    return { extended: false, futureWeeks: 0, pastWeeks: 0, eventsAdded: 0 };
  }

  const provider = getProvider(account.provider as Provider);
  const accessToken = await getAccessToken(accountId);
  const calendarList = await provider.getCalendars(accessToken);
  const colorMap = new Map(calendarList.map((c) => [c.id, c.color]));

  for (const calendar of calendars) {
    try {
      const { minWeek, maxWeek } = await getFetchedBounds(
        accountId,
        calendar.calendarId
      );

      if (!minWeek || !maxWeek) {
        // No weeks fetched yet - skip (initial sync will handle it)
        continue;
      }

      const color = colorMap.get(calendar.calendarId) || "#4285f4";

      // Check future edge: how many weeks until we hit maxWeek
      const weeksUntilMax = getWeekDistance(currentWeek, maxWeek);
      if (weeksUntilMax < EDGE_THRESHOLD_WEEKS) {
        const newMaxWeek = addWeeks(maxWeek, EXTENSION_WEEKS);
        console.log(
          `[reanchor] Extending future for ${calendar.calendarId}: ${maxWeek} -> ${newMaxWeek} (${weeksUntilMax} weeks until edge)`
        );

        const eventsAdded = await fetchWeekRange(
          accountId,
          calendar.calendarId,
          color,
          addWeeks(maxWeek, 1), // Start from week after current max
          newMaxWeek
        );

        totalFutureWeeks += EXTENSION_WEEKS;
        totalEventsAdded += eventsAdded;
      }

      // Check past edge: how many weeks since minWeek
      const weeksFromMin = getWeekDistance(minWeek, currentWeek);
      if (weeksFromMin < EDGE_THRESHOLD_WEEKS) {
        const newMinWeek = addWeeks(minWeek, -EXTENSION_WEEKS);
        console.log(
          `[reanchor] Extending past for ${calendar.calendarId}: ${minWeek} -> ${newMinWeek} (${weeksFromMin} weeks from edge)`
        );

        const eventsAdded = await fetchWeekRange(
          accountId,
          calendar.calendarId,
          color,
          newMinWeek,
          addWeeks(minWeek, -1) // End at week before current min
        );

        totalPastWeeks += EXTENSION_WEEKS;
        totalEventsAdded += eventsAdded;
      }
    } catch (error) {
      console.error(
        `[reanchor] Failed for calendar ${calendar.calendarId}:`,
        error
      );
      // Continue with other calendars
    }
  }

  const extended = totalFutureWeeks > 0 || totalPastWeeks > 0;

  // Update last reanchor timestamp
  await db
    .update(accounts)
    .set({ lastReanchorAt: new Date() })
    .where(eq(accounts.id, accountId));

  if (extended) {
    console.log(
      `[reanchor] Account ${accountId}: extended ${totalFutureWeeks} future weeks, ${totalPastWeeks} past weeks, ${totalEventsAdded} events added`
    );
  }

  return {
    extended,
    futureWeeks: totalFutureWeeks,
    pastWeeks: totalPastWeeks,
    eventsAdded: totalEventsAdded,
  };
}
