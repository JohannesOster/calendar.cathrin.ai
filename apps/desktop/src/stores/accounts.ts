import { createSignal } from "solid-js";
import { startServerOAuth, isAuthenticated } from "./auth";
import { apiFetch } from "../lib/api";
import type { SyncStatus } from "@cathrin/shared-types";

export interface Calendar {
  id: string;
  name: string;
  color: string;
  visible: boolean;
}

export interface CalendarAccount {
  id: string;
  email: string;
  calendars: Calendar[];
  syncStatus: SyncStatus;
}

// Signals for account state
export const [connectedAccounts, setConnectedAccounts] = createSignal<
  CalendarAccount[]
>([]);
export const [authError, setAuthError] = createSignal<string | null>(null);
export const [defaultCalendarId, setDefaultCalendarId] = createSignal<
  string | null
>(null);

// =============================================================================
// Cross-module registrations
//
// account-ordering.ts and account-sync.ts register their functions here at
// import time. This breaks circular imports: accounts.ts never imports from
// those modules, they import from accounts.ts and call these registration fns.
// =============================================================================

let _fetchAccountsFromServer: (() => Promise<CalendarAccount[]>) | null = null;
let _loadOrderingPreferences: ((accounts: CalendarAccount[]) => void) | null = null;
let _setCalendarVisibilityLocal: ((calendarId: string, visible: boolean) => void) | null = null;

/** Called by account-sync.ts to share its fetch function. */
export function _registerAccountSyncFn(fn: () => Promise<CalendarAccount[]>): void {
  _fetchAccountsFromServer = fn;
}

/** Called by account-ordering.ts to share its ordering functions. */
export function _registerOrderingFns(fns: {
  loadOrderingPreferences: (accounts: CalendarAccount[]) => void;
  setCalendarVisibilityLocal: (calendarId: string, visible: boolean) => void;
}): void {
  _loadOrderingPreferences = fns.loadOrderingPreferences;
  _setCalendarVisibilityLocal = fns.setCalendarVisibilityLocal;
}

// Flag to track if accounts have been initialized
let initialized = false;

/**
 * Initialize accounts from server
 * Should be called once on app startup after auth is initialized
 */
export async function initializeAccounts(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // Skip if not authenticated
  if (!isAuthenticated()) {
    return;
  }

  try {
    // Load existing accounts from server
    const accounts = await _fetchAccountsFromServer!();
    setConnectedAccounts(accounts);
    _loadOrderingPreferences?.(accounts);
  } catch (error) {
    console.error("Failed to load accounts:", error);
  }
}

/**
 * Start the OAuth flow to add a new calendar account
 * Opens the browser to the server OAuth endpoint
 * Accounts will be reloaded automatically when auth completes
 */
export async function addAccount(): Promise<void> {
  setAuthError(null);

  try {
    // Open browser to server OAuth endpoint
    // The OAuth flow completes async - accounts reload via the auth effect
    await startServerOAuth();
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error("Failed to start OAuth:", error);
    setAuthError(errorMessage || "Failed to add account");
  }
}

/**
 * Remove a connected account
 */
export async function deleteAccount(accountId: string): Promise<void> {
  try {
    await apiFetch(`/api/accounts/${accountId}`, { method: "DELETE" });
    setConnectedAccounts((prev) => prev.filter((a) => a.id !== accountId));
  } catch (error) {
    console.error("Failed to remove account:", error);
    throw error;
  }
}

/**
 * Toggle calendar visibility for a specific calendar
 * Visibility is stored locally as a client-side preference
 */
export async function updateCalendarVisibility(
  accountId: string,
  calendarId: string,
  visible: boolean,
): Promise<void> {
  // Save to localStorage
  _setCalendarVisibilityLocal?.(calendarId, visible);

  // Update local state
  setConnectedAccounts((prev) =>
    prev.map((account) => {
      if (account.id !== accountId) return account;
      return {
        ...account,
        calendars: account.calendars.map((cal) =>
          cal.id === calendarId ? { ...cal, visible } : cal,
        ),
      };
    }),
  );
}
