import { apiFetch } from "../lib/api";
import { mapProviderColor } from "../lib/color-mapping";

import { isAuthenticated, onAuthComplete } from "./auth";
import { connectedAccounts, setConnectedAccounts, _registerAccountSyncFn, type CalendarAccount } from "./accounts";
import { getCalendarVisibility, loadOrderingPreferences } from "./account-ordering";
import { refreshEvents } from "./event-fetching";
import type { ApiAccount, ApiCalendar } from "@cathrin/shared-types";

/**
 * Response format from the calendars API
 */
interface AccountCalendarsResult {
  accountId: string;
  calendars: ApiCalendar[];
  error?: string;
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
      })),
    );
  }

  // Merge accounts with calendars
  return accounts.map((account) => ({
    id: account.id,
    email: account.email,
    calendars: calendarsByAccount.get(account.id) || [],
    syncStatus: account.syncStatus ?? "pending",
  }));
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

// Register with accounts.ts so it can call our function without importing us
// (breaking the circular dependency: account-sync -> accounts -> account-sync).
_registerAccountSyncFn(fetchAccountsFromServer);

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
