import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts } from "../db/schema.js";
import { authMiddleware } from "../middlewares/auth.js";
import { getAccessToken } from "../services/token-refresh.js";
import { TokenExpiredError, TokenRevokedError } from "../providers/types.js";
import { getProvider } from "../providers/registry.js";
import type { ApiCalendar, Provider, SyncStatus } from "@cathrin/shared-types";

interface AccountCalendarsResult {
  accountId: string;
  calendars: ApiCalendar[];
  syncStatus?: SyncStatus;
  error?: string;
}

export const calendarsRoute = new Hono()
  .use("*", authMiddleware)
  .get("/", async (c) => {
    if (!db) {
      return c.json({ error: "Database not configured" }, 500);
    }

    const userId = c.get("userId");

    // Get all accounts for this user
    const userAccounts = await db.query.accounts.findMany({
      where: eq(accounts.userId, userId),
    });

    // Fetch calendars for each account in parallel
    const results: AccountCalendarsResult[] = await Promise.all(
      userAccounts.map(async (account) => {
        try {
          // Get a valid access token (refreshes if needed)
          const provider = getProvider(account.provider as Provider);
          const accessToken = await getAccessToken(account.id);
          const calendars = await provider.getCalendars(accessToken);

          return {
            accountId: account.id,
            calendars: calendars.map((cal) => ({
              ...cal,
              accountId: account.id,
            })),
            syncStatus: (account.syncStatus as SyncStatus) ?? "pending",
          };
        } catch (error) {
          console.error(
            `Failed to fetch calendars for account ${account.email}:`,
            error
          );

          // Return partial results with error info
          if (
            error instanceof TokenRevokedError ||
            error instanceof TokenExpiredError
          ) {
            return {
              accountId: account.id,
              calendars: [],
              syncStatus: "auth_error",
              error: "Token expired or revoked - re-authorization required",
            };
          }

          return {
            accountId: account.id,
            calendars: [],
            syncStatus: (account.syncStatus as SyncStatus) ?? "pending",
            error: error instanceof Error ? error.message : "Failed to fetch calendars",
          };
        }
      })
    );

    return c.json(results);
  });
