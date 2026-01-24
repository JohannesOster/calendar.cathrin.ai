import { createSignal } from "solid-js";
import {
  getConnectedAccounts,
  removeAccount as removeAccountApi,
  startOAuthFlow,
} from "../services/auth";
import {
  toggleCalendarVisibility as toggleCalendarVisibilityApi,
  refreshAccountCalendars,
} from "../services/calendar";

export interface Calendar {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  isDefault?: boolean;
}

export interface CalendarAccount {
  id: string;
  email: string;
  calendars: Calendar[];
}

// Signals for account state
export const [connectedAccounts, setConnectedAccounts] = createSignal<
  CalendarAccount[]
>([]);
export const [isAuthenticating, setIsAuthenticating] =
  createSignal<boolean>(false);
export const [authError, setAuthError] = createSignal<string | null>(null);

// Flag to track if accounts have been initialized
let initialized = false;

/**
 * Initialize accounts from storage
 * Should be called once on app startup
 */
export async function initializeAccounts(): Promise<void> {
  if (initialized) return;
  initialized = true;

  try {
    // Load existing accounts from storage
    const accounts = await getConnectedAccounts();
    setConnectedAccounts(accounts);
  } catch (error) {
    console.error("Failed to load accounts:", error);
  }
}

/**
 * Start the OAuth flow to add a new calendar account
 * This opens the browser, waits for authorization, and returns the account
 */
export async function addAccount(): Promise<void> {
  setIsAuthenticating(true);
  setAuthError(null);

  try {
    // The OAuth flow now runs completely in the backend and returns the account
    const account = await startOAuthFlow();

    // Add the new account to the list
    setConnectedAccounts((prev) => {
      // Replace if account already exists, otherwise add
      const exists = prev.some((a) => a.id === account.id);
      if (exists) {
        return prev.map((a) => (a.id === account.id ? account : a));
      }
      return [...prev, account];
    });
  } catch (error) {
    console.error("Failed to add account:", error);
    setAuthError(
      error instanceof Error ? error.message : "Failed to add account"
    );
  } finally {
    setIsAuthenticating(false);
  }
}

/**
 * Remove a connected account
 */
export async function deleteAccount(accountId: string): Promise<void> {
  try {
    await removeAccountApi(accountId);
    setConnectedAccounts((prev) => prev.filter((a) => a.id !== accountId));
  } catch (error) {
    console.error("Failed to remove account:", error);
    throw error;
  }
}

/**
 * Toggle calendar visibility for a specific calendar
 */
export async function updateCalendarVisibility(
  accountId: string,
  calendarId: string,
  visible: boolean
): Promise<void> {
  try {
    await toggleCalendarVisibilityApi(accountId, calendarId, visible);
    // Update local state
    setConnectedAccounts((prev) =>
      prev.map((account) => {
        if (account.id !== accountId) return account;
        return {
          ...account,
          calendars: account.calendars.map((cal) =>
            cal.id === calendarId ? { ...cal, visible } : cal
          ),
        };
      })
    );
  } catch (error) {
    console.error("Failed to update calendar visibility:", error);
    throw error;
  }
}

/**
 * Refresh calendars for an account (fetches latest from Google)
 */
export async function refreshAccount(accountId: string): Promise<void> {
  try {
    const updatedAccount = await refreshAccountCalendars(accountId);
    setConnectedAccounts((prev) =>
      prev.map((a) => (a.id === accountId ? updatedAccount : a))
    );
  } catch (error) {
    console.error("Failed to refresh account:", error);
    throw error;
  }
}
