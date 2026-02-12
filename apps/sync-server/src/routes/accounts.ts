import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts } from "../db/schema.js";
import { authMiddleware } from "../middlewares/auth.js";
import { cleanupAccountChannels } from "../services/watch-manager.js";
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
        syncStatus: true,
        syncError: true,
        lastSyncAt: true,
      },
    });

    // Map to API format (convert Date to ISO string)
    const apiAccounts: ApiAccount[] = userAccounts.map((account) => ({
      id: account.id,
      email: account.email,
      provider: account.provider as ApiAccount["provider"],
      syncStatus: (account.syncStatus as ApiAccount["syncStatus"]) ?? "pending",
      syncError: account.syncError,
      lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
    }));

    return c.json(apiAccounts);
  })
  .delete("/:id", async (c) => {
    if (!db) {
      return c.json({ error: "Database not configured" }, 500);
    }

    const userId = c.get("userId");
    const accountId = c.req.param("id");

    // Stop watch channels on Google's side before deleting (best effort)
    await cleanupAccountChannels(accountId).catch((err) => {
      console.error(`[accounts] Failed to cleanup watch channels for ${accountId}:`, err);
    });

    const deleted = await db
      .delete(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
      .returning({ id: accounts.id });

    if (deleted.length === 0) {
      return c.json({ error: "Account not found" }, 404);
    }

    return c.json({ success: true });
  });
