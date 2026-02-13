import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { authMiddleware } from "../middlewares/auth.js";
import { getUserAccountIds } from "../services/account-lookup.js";

const suggestionsQuerySchema = z.object({
  q: z.string().optional().default(""),
  limit: z.coerce.number().int().min(1).max(50).optional().default(8),
});

export const contactsRoute = new Hono()
  .use("*", authMiddleware)
  .get("/suggestions", zValidator("query", suggestionsQuerySchema), async (c) => {
    if (!db) {
      return c.json({ error: "Database not configured" }, 500);
    }

    const userId = c.get("userId");
    const { q, limit } = c.req.valid("query");

    const accountIds = await getUserAccountIds(userId);
    if (accountIds.length === 0) {
      return c.json({ contacts: [] });
    }

    const search = q.trim().toLowerCase();
    const accountIdsArray = sql`ARRAY[${sql.join(accountIds.map(id => sql`${id}`), sql`, `)}]`;

    const rows = await db.execute(sql`
      WITH attendee_stats AS (
        SELECT
          LOWER(att->>'email') AS email,
          (array_agg(att->>'name' ORDER BY e.start DESC)
            FILTER (WHERE att->>'name' IS NOT NULL AND att->>'name' != '')
          )[1] AS name,
          COUNT(DISTINCT e.id)::int AS frequency,
          MAX(e.start) AS last_seen
        FROM events e,
          jsonb_array_elements(e.attendees) AS att
        WHERE e.account_id = ANY(${accountIdsArray})
          AND e.attendees IS NOT NULL
          AND COALESCE((att->>'isSelf')::boolean, false) IS NOT TRUE
          AND att->>'email' IS NOT NULL
          AND att->>'email' != ''
        GROUP BY LOWER(att->>'email')
      ),
      scored_attendees AS (
        SELECT
          email,
          name,
          frequency * EXP(
            -EXTRACT(EPOCH FROM (NOW() - last_seen)) / 86400.0 / 180.0
          )
          -- Prefix matches rank above substring-only matches
          * CASE WHEN ${search} != '' AND (
            email LIKE ${search} || '%'
            OR LOWER(COALESCE(name, '')) LIKE ${search} || '%'
          ) THEN 2.0 ELSE 1.0 END
          AS score
        FROM attendee_stats
        WHERE (
          ${search} = ''
          OR email LIKE '%' || ${search} || '%'
          OR LOWER(COALESCE(name, '')) LIKE '%' || ${search} || '%'
        )
      ),
      provider_fallback AS (
        SELECT DISTINCT ON (LOWER(pc.email))
          LOWER(pc.email) AS email,
          pc.name,
          0.5
          * CASE WHEN ${search} != '' AND (
            LOWER(pc.email) LIKE ${search} || '%'
            OR LOWER(COALESCE(pc.name, '')) LIKE ${search} || '%'
          ) THEN 2.0 ELSE 1.0 END
          AS score
        FROM provider_contacts pc
        WHERE pc.account_id = ANY(${accountIdsArray})
          AND LOWER(pc.email) NOT IN (SELECT email FROM scored_attendees)
          AND (
            ${search} = ''
            OR LOWER(pc.email) LIKE '%' || ${search} || '%'
            OR LOWER(COALESCE(pc.name, '')) LIKE '%' || ${search} || '%'
          )
      ),
      combined AS (
        SELECT email, name, score FROM scored_attendees
        UNION ALL
        SELECT email, name, score FROM provider_fallback
      )
      SELECT email, name, score
      FROM combined
      ORDER BY score DESC
      LIMIT ${limit}
    `);

    const contacts = rows.map((row: Record<string, unknown>) => ({
      email: row.email as string,
      name: (row.name as string) || null,
      score: Math.round((row.score as number) * 100) / 100,
    }));

    return c.json({ contacts });
  });
