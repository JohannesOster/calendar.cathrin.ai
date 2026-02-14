import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, serverEvents, fetchedWeeks } from "../db/schema.js";

/**
 * Get all account IDs for a user. Returns empty array if none found.
 */
export async function getUserAccountIds(userId: string): Promise<string[]> {
  if (!db) return [];

  const userAccounts = await db.query.accounts.findMany({
    where: eq(accounts.userId, userId),
    columns: { id: true },
  });

  return userAccounts.map((a) => a.id);
}

/**
 * Find which account owns a calendar by checking serverEvents then fetchedWeeks.
 * Returns { accountId, color } or null if not found.
 */
export async function resolveCalendarOwner(
  accountIds: string[],
  calendarId: string
): Promise<{ accountId: string; color: string | null } | null> {
  if (!db || accountIds.length === 0) return null;

  // Check serverEvents first
  const existingEvent = await db.query.serverEvents.findFirst({
    where: and(
      inArray(serverEvents.accountId, accountIds),
      eq(serverEvents.calendarId, calendarId)
    ),
    columns: { accountId: true, color: true },
  });

  if (existingEvent) {
    return { accountId: existingEvent.accountId, color: existingEvent.color };
  }

  // Calendar might be empty -- check fetchedWeeks
  const weekEntry = await db.query.fetchedWeeks.findFirst({
    where: and(
      inArray(fetchedWeeks.accountId, accountIds),
      eq(fetchedWeeks.calendarId, calendarId)
    ),
    columns: { accountId: true },
  });

  if (weekEntry) {
    return { accountId: weekEntry.accountId, color: null };
  }

  return null;
}

/**
 * Find an event by providerEventId owned by one of the given accounts.
 * When calendarId is provided, narrows to the specific calendar copy
 * (critical for cross-account events where the same providerEventId exists
 * on multiple accounts with different permissions).
 * Returns the full event row or null.
 */
export async function findUserEvent(accountIds: string[], providerEventId: string, calendarId?: string) {
  if (!db || accountIds.length === 0) return null;

  const conditions = [
    inArray(serverEvents.accountId, accountIds),
    eq(serverEvents.providerEventId, providerEventId),
  ];

  if (calendarId) {
    conditions.push(eq(serverEvents.calendarId, calendarId));
  }

  return db.query.serverEvents.findFirst({
    where: and(...conditions),
  });
}
