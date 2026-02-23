import { apiFetch } from "../lib/api";
import { mapProviderColor } from "../lib/color-mapping";

import { isAuthenticated, onAuthComplete, onLogout } from "./auth";
import { connectedAccounts, setConnectedAccounts, _registerAccountSyncFn, _registerAccountCacheFns, type CalendarAccount } from "./accounts";
import { getCalendarVisibility, loadOrderingPreferences } from "./account-ordering";
import { refreshEvents } from "./event-fetching";
import type { ApiAccount, ApiCalendar } from "@cathrin/shared-types";

const ACCOUNTS_CACHE_KEY = "cached-accounts";

/**
 * Response format from the calendars API
 */
interface AccountCalendarsResult {
  accountId: string;
  calendars: ApiCalendar[];
  error?: string;
}

/**
 * Read cached accounts from localStorage, re-applying current visibility.
 */
function getCachedAccounts(): CalendarAccount[] | null {
  try {
    const raw = localStorage.getItem(ACCOUNTS_CACHE_KEY);
    if (!raw) return null;
    const accounts: CalendarAccount[] = JSON.parse(raw);
    // Re-apply visibility from localStorage (may have changed since cache was written)
    for (const account of accounts) {
      for (const cal of account.calendars) {
        cal.visible = getCalendarVisibility(cal.id);
      }
    }
    return accounts;
  } catch {
    return null;
  }
}

/**
 * Write current accounts signal to localStorage cache.
 */
function syncAccountsToCache(): void {
  try {
    localStorage.setItem(ACCOUNTS_CACHE_KEY, JSON.stringify(connectedAccounts()));
  } catch {
    // localStorage full or unavailable — non-critical
  }
}

/**
 * Fetch accounts and calendars from the sync server
 */
export async function fetchAccountsFromServer(): Promise<CalendarAccount[]> {
  // Fetch accounts and calendars in parallel
  const [accounts, calendarsResponse] = await Promise.all([
    apiFetch<ApiAccount[]>("/api/accounts"),
    apiFetch<AccountCalendarsResult[]>("/api/calendars"),
  ]);

  // Build calendars map by account
  const calendarsByAccount = new Map<string, CalendarAccount["calendars"]>();
  for (const result of calendarsResponse) {
    calendarsByAccount.set(
      result.accountId,
      result.calendars.map((c) => ({
        id: c.id,
        name: c.name,
        color: mapProviderColor(c.color),
        // Use local visibility preference (client-side setting)
        visible: getCalendarVisibility(c.id),
        accessRole: c.accessRole,
        canCreateConference: c.canCreateConference,
      })),
    );
  }

  // Merge accounts with calendars
  const result = accounts.map((account) => ({
    id: account.id,
    email: account.email,
    provider: account.provider,
    calendars: calendarsByAccount.get(account.id) || [],
    syncStatus: account.syncStatus ?? "pending",
  }));

  // Cache for instant startup next time
  try {
    localStorage.setItem(ACCOUNTS_CACHE_KEY, JSON.stringify(result));
  } catch {
    // non-critical
  }

  return result;
}

/**
 * Reload accounts from the server
 * Call this after OAuth completes to fetch the new account
 */
export async function reloadAccounts(): Promise<void> {
  if (!isAuthenticated()) {
    return;
  }

  try {
    const accounts = await fetchAccountsFromServer();
    setConnectedAccounts(accounts);
    loadOrderingPreferences(accounts);
  } catch (error) {
    console.error("Failed to reload accounts:", error);
  }
}

/**
 * Refresh calendars for all accounts (re-fetches from server)
 */
export async function refreshAccounts(): Promise<void> {
  try {
    const accounts = await fetchAccountsFromServer();
    setConnectedAccounts(accounts);
  } catch (error) {
    console.error("Failed to refresh accounts:", error);
    throw error;
  }
}

/**
 * Check if any account is currently syncing
 */
export function isAnySyncing(): boolean {
  return connectedAccounts().some(
    (a) => a.syncStatus === "pending" || a.syncStatus === "syncing"
  );
}

/**
 * Poll for sync completion after adding an account
 * Polls every 2 seconds until all accounts are synced, then refreshes events
 */
async function pollUntilSyncComplete(): Promise<void> {
  const POLL_INTERVAL = 2000; // 2 seconds
  const MAX_POLLS = 60; // Max 2 minutes of polling
  let polls = 0;

  console.log("[accounts] Starting sync status polling...");

  while (polls < MAX_POLLS) {
    await reloadAccounts();

    if (!isAnySyncing()) {
      console.log("[accounts] All accounts synced, refreshing events");
      refreshEvents();
      return;
    }

    polls++;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }

  console.warn("[accounts] Sync polling timed out after 2 minutes");
  // Refresh events anyway with whatever data we have
  refreshEvents();
}

// Register with accounts.ts so it can call our functions without importing us
// (breaking the circular dependency: account-sync -> accounts -> account-sync).
_registerAccountSyncFn(fetchAccountsFromServer);
_registerAccountCacheFns({ getCached: getCachedAccounts, syncToCache: syncAccountsToCache });

// Clear account cache on logout so no stale data persists
onLogout(() => localStorage.removeItem(ACCOUNTS_CACHE_KEY));

// Register callback to reload accounts when auth completes
// This handles both initial login and adding additional accounts
onAuthComplete(async () => {
  await reloadAccounts();

  // If any account is still syncing, poll until complete
  if (isAnySyncing()) {
    pollUntilSyncComplete();
  } else {
    // All accounts already synced, just refresh events
    refreshEvents();
  }
});
