import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, lte, gte, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, serverEvents } from "../db/schema.js";
import { authMiddleware } from "../middlewares/auth.js";
import { getWeeksInRange } from "../lib/week-utils.js";
import { handleGoogleApiError } from "../lib/google-error.js";
import {
  ensureWeeksFetched,
  getCalendarsToCheck,
} from "../services/calendar-sync.js";
import { getUserAccountIds, resolveCalendarOwner, findUserEvent } from "../services/account-lookup.js";
import { createEventViaGoogle, updateEventViaGoogle, deleteEventViaGoogle, moveEventViaGoogle, rsvpEventViaGoogle } from "../services/event-mutations.js";
import { mapServerEventToApi } from "../services/event-mapper.js";

const querySchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    calendarIds: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .refine((data) => data.from <= data.to, {
    message: "'from' must be before or equal to 'to'",
    path: ["from"],
  });

export const eventsRoute = new Hono()
  .use("*", authMiddleware)
  .get("/", zValidator("query", querySchema), async (c) => {
    if (!db) {
      return c.json({ error: "Database not configured" }, 500);
    }

    const userId = c.get("userId");
    const { from, to, calendarIds: rawCalendarIds } = c.req.valid("query");

    const calendarIds = rawCalendarIds
      ? Array.isArray(rawCalendarIds)
        ? rawCalendarIds
        : [rawCalendarIds]
      : undefined;

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

    const calendarsToCheck = await getCalendarsToCheck(accountIds, calendarIds);

    await Promise.all(
      calendarsToCheck.map((cal) =>
        ensureWeeksFetched(cal.accountId, cal.calendarId, cal.color, weeksNeeded, cal.accessRole)
      )
    );

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

    return c.json(events.map(mapServerEventToApi));
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
        transparency: z.enum(["opaque", "transparent"]).optional(),
        visibility: z.enum(["default", "public", "private"]).optional(),
        reminders: z.array(z.object({ method: z.string(), minutes: z.number().min(0).max(40320) })).max(5).optional(),
        colorId: z.string().optional(),
        conferencing: z.union([
          z.object({ type: z.literal("meet") }),
          z.object({ type: z.literal("manual"), uri: z.string().url() }),
        ]).nullable().optional(),
        timeZone: z.string().optional(),
      })
    ),
    async (c) => {
      if (!db) {
        return c.json({ error: "Database not configured" }, 500);
      }

      const userId = c.get("userId");
      const { calendarId, title, start, end, isAllDay, location, description, transparency, visibility, reminders, colorId, conferencing, timeZone } = c.req.valid("json");

      const accountIds = await getUserAccountIds(userId);
      if (accountIds.length === 0) {
        return c.json({ error: "No accounts found" }, 404);
      }

      const owner = await resolveCalendarOwner(accountIds, calendarId);
      if (!owner) {
        return c.json({ error: "Calendar not found" }, 404);
      }

      try {
        const apiEvent = await createEventViaGoogle(
          owner.accountId, calendarId, title, start, end, isAllDay, owner.color, location, description, transparency, visibility, reminders, colorId, conferencing, timeZone
        );
        return c.json(apiEvent, 201);
      } catch (error) {
        const errorResponse = handleGoogleApiError(error, c);
        if (errorResponse) return errorResponse;
        throw error;
      }
    }
  )
  .patch(
    "/:eventId",
    zValidator(
      "json",
      z.object({
        summary: z.string().optional(),
        description: z.string().optional(),
        location: z.string().optional(),
        start: z.union([z.string().datetime(), z.string().date()]).optional(),
        end: z.union([z.string().datetime(), z.string().date()]).optional(),
        isAllDay: z.boolean().optional(),
        transparency: z.enum(["opaque", "transparent"]).optional(),
        visibility: z.enum(["default", "public", "private"]).optional(),
        reminders: z.array(z.object({ method: z.string(), minutes: z.number().min(0).max(40320) })).max(5).nullable().optional(),
        colorId: z.string().nullable().optional(),
        conferencing: z.union([
          z.object({ type: z.literal("meet") }),
          z.object({ type: z.literal("manual"), uri: z.string().url() }),
        ]).nullable().optional(),
        timeZone: z.string().optional(),
      })
    ),
    async (c) => {
      if (!db) {
        return c.json({ error: "Database not configured" }, 500);
      }

      const userId = c.get("userId");
      const googleEventId = c.req.param("eventId");
      const patch = c.req.valid("json");

      const accountIds = await getUserAccountIds(userId);
      if (accountIds.length === 0) {
        return c.json({ error: "No accounts found" }, 404);
      }

      const event = await findUserEvent(accountIds, googleEventId);
      if (!event) {
        return c.json({ error: "Event not found" }, 404);
      }

      try {
        const apiEvent = await updateEventViaGoogle(
          event.accountId, event.calendarId, googleEventId, patch, event
        );
        return c.json(apiEvent);
      } catch (error) {
        const errorResponse = handleGoogleApiError(error, c);
        if (errorResponse) return errorResponse;
        throw error;
      }
    }
  )
  .delete("/:eventId", async (c) => {
    if (!db) {
      return c.json({ error: "Database not configured" }, 500);
    }

    const userId = c.get("userId");
    const googleEventId = c.req.param("eventId");

    const accountIds = await getUserAccountIds(userId);
    if (accountIds.length === 0) {
      return c.json({ error: "No accounts found" }, 404);
    }

    const event = await findUserEvent(accountIds, googleEventId);
    if (!event) {
      return c.json({ error: "Event not found" }, 404);
    }

    try {
      await deleteEventViaGoogle(event.accountId, event.calendarId, googleEventId, event.id);
      return c.json({ success: true });
    } catch (error) {
      const errorResponse = handleGoogleApiError(error, c);
      if (errorResponse) return errorResponse;
      throw error;
    }
  })
  .patch(
    "/:eventId/rsvp",
    zValidator(
      "json",
      z.object({
        responseStatus: z.enum(["accepted", "declined", "tentative"]),
      })
    ),
    async (c) => {
      if (!db) {
        return c.json({ error: "Database not configured" }, 500);
      }

      const userId = c.get("userId");
      const googleEventId = c.req.param("eventId");
      const { responseStatus } = c.req.valid("json");

      const accountIds = await getUserAccountIds(userId);
      if (accountIds.length === 0) {
        return c.json({ error: "No accounts found" }, 404);
      }

      const event = await findUserEvent(accountIds, googleEventId);
      if (!event) {
        return c.json({ error: "Event not found" }, 404);
      }

      try {
        const apiEvent = await rsvpEventViaGoogle(
          event.accountId, event.calendarId, googleEventId, responseStatus, event
        );
        return c.json(apiEvent);
      } catch (error) {
        const errorResponse = handleGoogleApiError(error, c);
        if (errorResponse) return errorResponse;
        throw error;
      }
    }
  )
  .post(
    "/:eventId/move",
    zValidator(
      "json",
      z.object({
        targetCalendarId: z.string().min(1),
      })
    ),
    async (c) => {
      if (!db) {
        return c.json({ error: "Database not configured" }, 500);
      }

      const userId = c.get("userId");
      const googleEventId = c.req.param("eventId");
      const { targetCalendarId } = c.req.valid("json");

      const accountIds = await getUserAccountIds(userId);
      if (accountIds.length === 0) {
        return c.json({ error: "No accounts found" }, 404);
      }

      const event = await findUserEvent(accountIds, googleEventId);
      if (!event) {
        return c.json({ error: "Event not found" }, 404);
      }

      if (event.calendarId === targetCalendarId) {
        return c.json({ error: "Event is already on this calendar" }, 400);
      }

      const targetOwner = await resolveCalendarOwner(accountIds, targetCalendarId);
      if (!targetOwner) {
        return c.json({ error: "Target calendar not found" }, 404);
      }

      try {
        const apiEvent = await moveEventViaGoogle(
          event.accountId, event.calendarId, targetCalendarId,
          googleEventId, event.id, targetOwner.color
        );
        return c.json(apiEvent);
      } catch (error) {
        const errorResponse = handleGoogleApiError(error, c);
        if (errorResponse) return errorResponse;
        throw error;
      }
    }
  );
