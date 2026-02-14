import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, providerContacts } from "../db/schema.js";
import { getAccessToken } from "./token-refresh.js";
import { getProvider } from "../providers/registry.js";
import type { Provider } from "@cathrin/shared-types";

const CONTACTS_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Track last sync per account in memory. After restart, re-syncs once — harmless.
const lastSyncMap = new Map<string, number>();

/**
 * Check if contacts need syncing for this account (once per 24h)
 */
export function shouldSyncContacts(accountId: string): boolean {
  const lastSync = lastSyncMap.get(accountId);
  if (!lastSync) return true;
  return Date.now() - lastSync > CONTACTS_SYNC_INTERVAL_MS;
}

/**
 * Fetch contacts via the provider and cache in provider_contacts table.
 * Dispatches through the provider's searchContacts method.
 * Gracefully handles providers that don't support contacts.
 */
export async function syncProviderContacts(accountId: string): Promise<void> {
  if (!db) return;

  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
    columns: { provider: true },
  });
  if (!account) return;

  const provider = getProvider(account.provider as Provider);
  if (!provider.searchContacts) {
    // Provider doesn't support contacts — mark as synced to avoid retrying
    lastSyncMap.set(accountId, Date.now());
    return;
  }

  const accessToken = await getAccessToken(accountId);

  let allContacts: { email: string; name: string | null }[];

  try {
    allContacts = await provider.searchContacts(accessToken);
  } catch (error) {
    console.error(`[contacts-provider] Failed to fetch contacts for ${accountId}:`, error);
    return;
  }

  // Deduplicate by email (keep first occurrence which has best name from provider's ordering)
  const seen = new Set<string>();
  allContacts = allContacts.filter((c) => {
    if (seen.has(c.email)) return false;
    seen.add(c.email);
    return true;
  });

  // Replace all cached contacts for this account in a single transaction
  // to prevent data loss if the insert fails after deletion.
  try {
    await db.transaction(async (tx) => {
      await tx.delete(providerContacts).where(eq(providerContacts.accountId, accountId));

      if (allContacts.length > 0) {
        const now = new Date();
        // Batch insert in chunks of 500 to stay within Postgres parameter limits
        const BATCH_SIZE = 500;
        for (let i = 0; i < allContacts.length; i += BATCH_SIZE) {
          const batch = allContacts.slice(i, i + BATCH_SIZE);
          await tx.insert(providerContacts).values(
            batch.map((c) => ({
              accountId,
              email: c.email,
              name: c.name,
              fetchedAt: now,
            }))
          );
        }
      }
    });

    lastSyncMap.set(accountId, Date.now());
    console.log(
      `[contacts-provider] Cached ${allContacts.length} contacts for account ${accountId}`
    );
  } catch (error) {
    console.error(`[contacts-provider] Failed to store contacts for ${accountId}:`, error);
  }
}
