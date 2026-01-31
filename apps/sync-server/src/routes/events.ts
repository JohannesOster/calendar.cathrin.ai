import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts } from "../db/schema.js";
import { authMiddleware } from "../middlewares/auth.js";
import { getAccessToken, TokenRevokedError } from "../services/token-refresh.js";
import {
  GoogleCalendarService,
  TokenExpiredError,
} from "../services/google-calendar.js";
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

    // Get all accounts for this user
    const userAccounts = await db.query.accounts.findMany({
      where: eq(accounts.userId, userId),
    });

    const allEvents: ApiCalendarEvent[] = [];
    const errors: { accountId: string; error: string }[] = [];

    // Fetch events from each account
    await Promise.all(
      userAccounts.map(async (account) => {
        try {
          const accessToken = await getAccessToken(account.id);
          const service = new GoogleCalendarService(accessToken);

          // Get calendars for this account
          const calendars = await service.fetchCalendarList();

          // Filter to requested calendars if specified
          const calendarsToFetch = calendarIds
            ? calendars.filter((cal) => calendarIds.includes(cal.id))
            : calendars;

          // Fetch events from each calendar in parallel
          const calendarEvents = await Promise.all(
            calendarsToFetch.map(async (calendar) => {
              try {
                return await service.fetchEvents(
                  calendar.id,
                  from,
                  to,
                  calendar.color
                );
              } catch (error) {
                console.error(
                  `Failed to fetch events for calendar ${calendar.id}:`,
                  error
                );
                return [];
              }
            })
          );

          allEvents.push(...calendarEvents.flat());
        } catch (error) {
          console.error(
            `Failed to fetch events for account ${account.email}:`,
            error
          );

          if (
            error instanceof TokenRevokedError ||
            error instanceof TokenExpiredError
          ) {
            errors.push({
              accountId: account.id,
              error: "Token expired or revoked - re-authorization required",
            });
          } else {
            errors.push({
              accountId: account.id,
              error:
                error instanceof Error
                  ? error.message
                  : "Failed to fetch events",
            });
          }
        }
      })
    );

    // Sort by start time
    allEvents.sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
    );

    return c.json(allEvents);
  });
