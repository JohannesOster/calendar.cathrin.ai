import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts } from "../db/schema.js";
import { authMiddleware } from "../middlewares/auth.js";
import type { ApiAccount } from "@cathrin/shared-types";

export const accountsRoute = new Hono()
  .use("*", authMiddleware)
  .get("/", async (c) => {
    if (!db) {
      return c.json({ error: "Database not configured" }, 500);
    }

    const userId = c.get("userId");

    const userAccounts = await db.query.accounts.findMany({
      where: eq(accounts.userId, userId),
      columns: {
        id: true,
        email: true,
        provider: true,
      },
    });

    return c.json(userAccounts as ApiAccount[]);
  })
  .delete("/:id", async (c) => {
    if (!db) {
      return c.json({ error: "Database not configured" }, 500);
    }

    const userId = c.get("userId");
    const accountId = c.req.param("id");

    const deleted = await db
      .delete(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
      .returning({ id: accounts.id });

    if (deleted.length === 0) {
      return c.json({ error: "Account not found" }, 404);
    }

    return c.json({ success: true });
  });
