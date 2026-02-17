import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, lte, gte, inArray, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, serverEvents, fetchedWeeks } from "../db/schema.js";
import { authMiddleware } from "../middlewares/auth.js";
import { getWeeksInRange } from "../lib/week-utils.js";
import { handleProviderError } from "../lib/provider-error.js";
import {
  ensureWeeksFetched,
  getCalendarsToCheck,
} from "../services/calendar-sync.js";
import { getUserAccountIds, resolveCalendarOwner, findUserEvent } from "../services/account-lookup.js";
import { createEvent, updateEvent, deleteEvent, moveEvent, rsvpEvent, splitOutlookSeriesEdit, truncateOutlookSeriesDelete } from "../services/event-mutations.js";
import { mapServerEventToApi } from "../services/event-mapper.js";
import { notifyUser } from "../services/ws-manager.js";
import type { Provider } from "@cathrin/shared-types";
import { getWeekId } from "../lib/week-utils.js";

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

    if (calendarsToCheck.length === 0) {
      console.log(
        `[events] No calendars found for on-demand sync (accounts: ${accountIds.length}, weeks: ${weeksNeeded.join(", ")})`
      );
    }

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

    const providerMap = new Map(userAccounts.map(a => [a.id, a.provider as Provider]));
    return c.json(events.map(e => mapServerEventToApi(e, providerMap.get(e.accountId))));
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
          z.object({ type: z.literal("create") }),
          z.object({ type: z.literal("manual"), uri: z.string().url() }),
        ]).nullable().optional(),
        timeZone: z.string().optional(),
        attendees: z.array(z.object({ email: z.string().email(), name: z.string().optional() })).optional(),
        sendUpdates: z.enum(["all", "none"]).optional(),
        recurrence: z.array(z.string()).optional(),
      })
    ),
    async (c) => {
      if (!db) {
        return c.json({ error: "Database not configured" }, 500);
      }

      const userId = c.get("userId");
      const { calendarId, title, start, end, isAllDay, location, description, transparency, visibility, reminders, colorId, conferencing, timeZone, attendees, sendUpdates, recurrence } = c.req.valid("json");

      const accountIds = await getUserAccountIds(userId);
      if (accountIds.length === 0) {
        return c.json({ error: "No accounts found" }, 404);
      }

      const owner = await resolveCalendarOwner(accountIds, calendarId);
      if (!owner) {
        return c.json({ error: "Calendar not found" }, 404);
      }

      try {
        const apiEvent = await createEvent({
          accountId: owner.accountId, calendarId, title, start, end, isAllDay,
          calendarColor: owner.color, location, description, transparency,
          visibility, reminders, colorId, conferencing, timeZone, attendees, sendUpdates, recurrence,
        });

        // Notify connected clients — skip the originating client (already has optimistic state)
        const clientId = c.req.header("X-Client-ID");
        const weekId = getWeekId(new Date(apiEvent.start));
        notifyUser(userId, {
          type: "weeks_changed",
          weekIds: [weekId],
          source: "mutation",
        }, clientId);

        return c.json(apiEvent, 201);
      } catch (error) {
        const errorResponse = handleProviderError(error, c);
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
          z.object({ type: z.literal("create") }),
          z.object({ type: z.literal("manual"), uri: z.string().url() }),
        ]).nullable().optional(),
        timeZone: z.string().optional(),
        attendees: z.array(z.object({ email: z.string().email(), name: z.string().optional() })).nullable().optional(),
        sendUpdates: z.enum(["all", "none"]).optional(),
        recurrence: z.array(z.string()).nullable().optional(),
      })
    ),
    async (c) => {
      if (!db) {
        return c.json({ error: "Database not configured" }, 500);
      }

      const userId = c.get("userId");
      const providerEventId = c.req.param("eventId");
      const { sendUpdates, ...patch } = c.req.valid("json");
      const scope = c.req.query("scope") as "single" | "all" | "following" | undefined;

      const accountIds = await getUserAccountIds(userId);
      if (accountIds.length === 0) {
        return c.json({ error: "No accounts found" }, 404);
      }

      const calendarId = c.req.query("calendarId");
      let event = await findUserEvent(accountIds, providerEventId, calendarId?.trim() || undefined);
      if (!event && providerEventId.includes("_")) {
        // Instance ID format: masterId_dateT — try finding the master
        const masterId = providerEventId.split("_")[0];
        event = await findUserEvent(accountIds, masterId, calendarId?.trim() || undefined);
      }
      if (!event) {
        return c.json({ error: "Event not found" }, 404);
      }

      try {
        // Outlook + "following" requires server-side series splitting
        if (scope === "following" && event.recurringEventId) {
          const account = await db!.query.accounts.findFirst({
            where: and(eq(accounts.id, event.accountId), inArray(accounts.id, accountIds)),
            columns: { provider: true },
          });

          if (account?.provider === "outlook") {
            const splitDate = event.start.toISOString().slice(0, 10);
            const apiEvent = await splitOutlookSeriesEdit(
              event.accountId, event.calendarId,
              event.recurringEventId as string, splitDate,
              patch, event, sendUpdates,
            );

            const clientId = c.req.header("X-Client-ID");
            notifyUser(userId, {
              type: "weeks_changed",
              weekIds: [getWeekId(event.start)],
              source: "mutation",
            }, clientId);

            return c.json(apiEvent);
          }
        }

        // Google + removing recurrence: Google ignores `recurrence: []` on a master event,
        // so we delete the entire series and re-create the edited instance as a standalone event.
        if (patch.recurrence === null && event.recurringEventId) {
          const account = await db!.query.accounts.findFirst({
            where: and(eq(accounts.id, event.accountId), inArray(accounts.id, accountIds)),
            columns: { provider: true },
          });

          if (account?.provider === "google" && (scope === "all" || scope === "following")) {
            if (scope === "all") {
              // Delete the entire series via the master event
              const masterId = event.recurringEventId as string;
              await deleteEvent(event.accountId, event.calendarId, masterId, event.id, sendUpdates, "all", event.start);
            } else {
              // "following": delete with the instance ID — Google truncates the master's RRULE
              // with an UNTIL date, preserving past instances
              await deleteEvent(event.accountId, event.calendarId, providerEventId, event.id, sendUpdates, "following", event.start);
            }

            // Re-create the edited instance as a standalone event
            const apiEvent = await createEvent({
              accountId: event.accountId,
              calendarId: event.calendarId,
              title: patch.summary ?? event.title,
              start: patch.start ?? event.start.toISOString(),
              end: patch.end ?? event.end.toISOString(),
              isAllDay: patch.isAllDay ?? event.isAllDay ?? undefined,
              location: patch.location ?? event.location ?? undefined,
              description: patch.description ?? event.description ?? undefined,
              transparency: (patch.transparency ?? event.transparency ?? undefined) as string | undefined,
              visibility: (patch.visibility ?? event.visibility ?? undefined) as string | undefined,
              reminders: patch.reminders === null ? undefined : (patch.reminders ?? event.reminders as { method: string; minutes: number }[] | undefined),
              colorId: patch.colorId === null ? undefined : (patch.colorId ?? event.colorId ?? undefined),
              timeZone: patch.timeZone ?? undefined,
              attendees: patch.attendees === null ? undefined : (patch.attendees ?? event.attendees as { email: string; name?: string }[] | undefined),
              sendUpdates,
              // No recurrence — this is now a standalone event
            });

            const clientId = c.req.header("X-Client-ID");
            const weekIds = new Set<string>();
            weekIds.add(getWeekId(event.start));
            weekIds.add(getWeekId(new Date(apiEvent.start)));
            notifyUser(userId, {
              type: "weeks_changed",
              weekIds: Array.from(weekIds),
              source: "mutation",
            }, clientId);

            return c.json(apiEvent);
          }
        }

        // For "all" scope on an instance, redirect to the master event.
        // For "following" scope on Google, pass the instance ID directly — Google handles the split.
        let targetEventId = providerEventId;
        let targetEvent = event;
        if (scope === "all" && event.recurringEventId) {
          targetEventId = event.recurringEventId as string;
          // Look up the master event so the provider gets correct existingEvent metadata
          const masterEvent = await findUserEvent(accountIds, targetEventId, event.calendarId);
          if (masterEvent) targetEvent = masterEvent;
        }

        const apiEvent = await updateEvent(
          event.accountId, event.calendarId, targetEventId, patch, targetEvent, sendUpdates
        );

        // When recurrence changes on a series, the old expanded instances in our
        // DB cache are stale (Google replaces them). Clean them up so revalidation
        // doesn't serve stale data back to the client.
        if (patch.recurrence !== undefined && (scope === "all" || scope === "following")) {
          const masterId = event.recurringEventId ?? providerEventId;
          if (scope === "all") {
            // Remove all cached instances AND the master event itself.
            // With singleEvents=true, the master shouldn't be in the DB — only
            // expanded instances should be. The PATCH response upserted the master,
            // so we need to remove it to avoid duplication with expanded instances.
            await db!.delete(serverEvents).where(
              and(
                eq(serverEvents.calendarId, event.calendarId),
                or(
                  eq(serverEvents.recurringEventId, masterId),
                  eq(serverEvents.providerEventId, masterId),
                ),
              )
            );
          } else if (scope === "following") {
            // Remove cached instances from the split point onwards
            await db!.delete(serverEvents).where(
              and(
                eq(serverEvents.calendarId, event.calendarId),
                eq(serverEvents.recurringEventId, masterId),
                gte(serverEvents.start, event.start),
              )
            );
          }

          // Invalidate fetchedWeeks so the next client revalidation triggers a
          // fresh fetch from Google (which returns proper expanded instances).
          const affectedWeekIds = new Set<string>();
          affectedWeekIds.add(getWeekId(event.start));
          affectedWeekIds.add(getWeekId(new Date(apiEvent.start)));
          // Also invalidate a broad range around the event so daily recurrences
          // get their instances fetched across multiple weeks.
          const rangeStart = new Date(event.start);
          rangeStart.setDate(rangeStart.getDate() - 7);
          const rangeEnd = new Date(event.start);
          rangeEnd.setDate(rangeEnd.getDate() + 60);
          for (const wk of getWeeksInRange(rangeStart, rangeEnd)) {
            affectedWeekIds.add(wk);
          }

          // Find all accountIds that own calendars with this calendarId
          const calendarAccounts = await db!.query.accounts.findMany({
            where: inArray(accounts.id, accountIds),
            columns: { id: true },
          });
          const calAccIds = calendarAccounts.map(a => a.id);

          if (affectedWeekIds.size > 0 && calAccIds.length > 0) {
            await db!.delete(fetchedWeeks).where(
              and(
                inArray(fetchedWeeks.accountId, calAccIds),
                eq(fetchedWeeks.calendarId, event.calendarId),
                inArray(fetchedWeeks.weekId, Array.from(affectedWeekIds)),
              )
            );
          }
        }

        // Notify connected clients — include both old and new weeks if event moved
        const clientId = c.req.header("X-Client-ID");
        const weekIds = new Set<string>();
        weekIds.add(getWeekId(event.start));
        weekIds.add(getWeekId(new Date(apiEvent.start)));
        notifyUser(userId, {
          type: "weeks_changed",
          weekIds: Array.from(weekIds),
          source: "mutation",
        }, clientId);

        return c.json(apiEvent);
      } catch (error) {
        const errorResponse = handleProviderError(error, c);
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
    const providerEventId = c.req.param("eventId");
    const sendUpdates = c.req.query("sendUpdates") as "all" | "none" | undefined;
    const scope = c.req.query("scope") as "single" | "all" | "following" | undefined;

    const accountIds = await getUserAccountIds(userId);
    if (accountIds.length === 0) {
      return c.json({ error: "No accounts found" }, 404);
    }

    const calendarId = c.req.query("calendarId");
    let event = await findUserEvent(accountIds, providerEventId, calendarId?.trim() || undefined);
    if (!event && providerEventId.includes("_")) {
      const masterId = providerEventId.split("_")[0];
      event = await findUserEvent(accountIds, masterId, calendarId?.trim() || undefined);
    }
    if (!event) {
      return c.json({ error: "Event not found" }, 404);
    }

    try {
      // Outlook + "following" requires server-side series truncation
      if (scope === "following" && event.recurringEventId) {
        const account = await db!.query.accounts.findFirst({
          where: and(eq(accounts.id, event.accountId), inArray(accounts.id, accountIds)),
          columns: { provider: true },
        });

        if (account?.provider === "outlook") {
          const splitDate = event.start.toISOString().slice(0, 10);
          await truncateOutlookSeriesDelete(
            event.accountId, event.calendarId,
            event.recurringEventId as string, splitDate, event.start,
          );

          const clientId = c.req.header("X-Client-ID");
          notifyUser(userId, {
            type: "weeks_changed",
            weekIds: [getWeekId(event.start)],
            source: "mutation",
          }, clientId);

          return c.json({ success: true });
        }
      }

      // For "all" scope on an instance, delete the master event instead.
      // For "following" scope on Google, pass the instance ID directly — Google handles the split.
      let targetEventId = providerEventId;
      if (scope === "all" && event.recurringEventId) {
        targetEventId = event.recurringEventId as string;
      }

      await deleteEvent(event.accountId, event.calendarId, targetEventId, event.id, sendUpdates, scope, event.start);

      // Notify connected clients — skip the originating client
      const clientId = c.req.header("X-Client-ID");
      const weekId = getWeekId(event.start);
      notifyUser(userId, {
        type: "weeks_changed",
        weekIds: [weekId],
        source: "mutation",
      }, clientId);

      return c.json({ success: true });
    } catch (error) {
      const errorResponse = handleProviderError(error, c);
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
        sendUpdates: z.enum(["all", "none"]).optional(),
      })
    ),
    async (c) => {
      if (!db) {
        return c.json({ error: "Database not configured" }, 500);
      }

      const userId = c.get("userId");
      const providerEventId = c.req.param("eventId");
      const { responseStatus, sendUpdates } = c.req.valid("json");

      const accountIds = await getUserAccountIds(userId);
      if (accountIds.length === 0) {
        return c.json({ error: "No accounts found" }, 404);
      }

      const calendarId = c.req.query("calendarId");
      const event = await findUserEvent(accountIds, providerEventId, calendarId?.trim() || undefined);
      if (!event) {
        return c.json({ error: "Event not found" }, 404);
      }

      try {
        const apiEvent = await rsvpEvent(
          event.accountId, event.calendarId, providerEventId, responseStatus, event, sendUpdates
        );

        const clientId = c.req.header("X-Client-ID");
        notifyUser(userId, {
          type: "weeks_changed",
          weekIds: [getWeekId(event.start)],
          source: "mutation",
        }, clientId);

        return c.json(apiEvent);
      } catch (error) {
        const errorResponse = handleProviderError(error, c);
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
      const providerEventId = c.req.param("eventId");
      const { targetCalendarId } = c.req.valid("json");

      const accountIds = await getUserAccountIds(userId);
      if (accountIds.length === 0) {
        return c.json({ error: "No accounts found" }, 404);
      }

      const calendarId = c.req.query("calendarId");
      const event = await findUserEvent(accountIds, providerEventId, calendarId?.trim() || undefined);
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
        const apiEvent = await moveEvent(
          event.accountId, event.calendarId, targetCalendarId,
          providerEventId, event.id, targetOwner.color
        );

        const clientId = c.req.header("X-Client-ID");
        notifyUser(userId, {
          type: "weeks_changed",
          weekIds: [getWeekId(event.start)],
          source: "mutation",
        }, clientId);

        return c.json(apiEvent);
      } catch (error) {
        const errorResponse = handleProviderError(error, c);
        if (errorResponse) return errorResponse;
        throw error;
      }
    }
  );
