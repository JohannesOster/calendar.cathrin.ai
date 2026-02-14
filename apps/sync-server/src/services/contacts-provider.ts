import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { providerContacts } from "../db/schema.js";
import { getAccessToken } from "./token-refresh.js";

const GOOGLE_PEOPLE_API_URL =
  "https://people.googleapis.com/v1/people/me/connections";
const PAGE_SIZE = 1000; // Max allowed by People API
const CONTACTS_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Track last sync per account in memory. After restart, re-syncs once — harmless.
const lastSyncMap = new Map<string, number>();

interface GooglePerson {
  resourceName: string;
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string }[];
}

interface PeopleConnectionsResponse {
  connections?: GooglePerson[];
  nextPageToken?: string;
  totalPeople?: number;
}

/**
 * Check if contacts need syncing for this account (once per 24h)
 */
export function shouldSyncContacts(accountId: string): boolean {
  const lastSync = lastSyncMap.get(accountId);
  if (!lastSync) return true;
  return Date.now() - lastSync > CONTACTS_SYNC_INTERVAL_MS;
}

/**
 * Fetch Google Contacts via People API and cache in provider_contacts table.
 * Gracefully handles missing scope (403) — just logs and skips.
 */
export async function syncProviderContacts(accountId: string): Promise<void> {
  if (!db) return;

  const accessToken = await getAccessToken(accountId);

  let allContacts: { email: string; name: string | null }[] = [];
  let pageToken: string | undefined;

  try {
    do {
      const url = new URL(GOOGLE_PEOPLE_API_URL);
      url.searchParams.set("personFields", "names,emailAddresses");
      url.searchParams.set("pageSize", String(PAGE_SIZE));
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      // 403 = missing contacts.readonly scope (existing users pre-scope-addition)
      if (response.status === 403) {
        console.log(
          `[contacts-provider] Skipping ${accountId} — contacts.readonly scope not granted`
        );
        lastSyncMap.set(accountId, Date.now());
        return;
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => response.statusText);
        console.error(
          `[contacts-provider] People API error ${response.status}: ${detail}`
        );
        return;
      }

      const data = (await response.json()) as PeopleConnectionsResponse;

      if (data.connections) {
        for (const person of data.connections) {
          const name = person.names?.[0]?.displayName || null;
          const emails = person.emailAddresses || [];
          for (const emailEntry of emails) {
            const email = emailEntry.value?.trim().toLowerCase();
            if (email) {
              allContacts.push({ email, name });
            }
          }
        }
      }

      pageToken = data.nextPageToken;
    } while (pageToken);
  } catch (error) {
    console.error(`[contacts-provider] Failed to fetch contacts for ${accountId}:`, error);
    return;
  }

  // Deduplicate by email (keep first occurrence which has best name from Google's ordering)
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
