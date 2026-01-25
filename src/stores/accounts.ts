import { createSignal, createMemo } from "solid-js";
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
export const [authError, setAuthError] = createSignal<string | null>(null);
export const [defaultCalendarId, setDefaultCalendarId] = createSignal<
  string | null
>(null);

const DEFAULT_CALENDAR_KEY = "default-calendar-id";
const ACCOUNT_ORDER_KEY = "account-order";
const CALENDAR_ORDER_KEY_PREFIX = "calendar-order-";

// Account ordering state - stores account IDs in display order
const [accountOrder, setAccountOrder] = createSignal<string[]>([]);

// Calendar ordering state - stores calendar IDs per account
const [calendarOrders, setCalendarOrders] = createSignal<
  Record<string, string[]>
>({});

/**
 * Get accounts sorted by the user's preferred order
 */
export const orderedAccounts = createMemo(() => {
  const accounts = connectedAccounts();
  const order = accountOrder();

  // If no order set, return accounts as-is
  if (order.length === 0) return accounts;

  // Sort accounts by their position in the order array
  // Accounts not in order go to the end
  return [...accounts].sort((a, b) => {
    const aIndex = order.indexOf(a.id);
    const bIndex = order.indexOf(b.id);
    // If not in order array, place at end (use large number)
    const aPos = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
    const bPos = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
    return aPos - bPos;
  });
});

/**
 * Get the ordered account IDs for SortableProvider
 */
export const orderedAccountIds = createMemo(() =>
  orderedAccounts().map((a) => a.id)
);

/**
 * Update account order and persist to localStorage
 */
export function setAccountOrderAndPersist(newOrder: string[]): void {
  setAccountOrder(newOrder);
  localStorage.setItem(ACCOUNT_ORDER_KEY, JSON.stringify(newOrder));
}

/**
 * Get calendars for an account sorted by the user's preferred order
 */
export function getOrderedCalendars(accountId: string): Calendar[] {
  const accounts = connectedAccounts();
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return [];

  const order = calendarOrders()[accountId];
  if (!order || order.length === 0) return account.calendars;

  // Sort calendars by their position in the order array
  return [...account.calendars].sort((a, b) => {
    const aIndex = order.indexOf(a.id);
    const bIndex = order.indexOf(b.id);
    const aPos = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
    const bPos = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
    return aPos - bPos;
  });
}

/**
 * Get ordered calendar IDs for an account (for SortableProvider)
 */
export function getOrderedCalendarIds(accountId: string): string[] {
  return getOrderedCalendars(accountId).map((c) => c.id);
}

/**
 * Update calendar order within an account and persist to localStorage
 */
export function setCalendarOrderAndPersist(
  accountId: string,
  newOrder: string[]
): void {
  setCalendarOrders((prev) => ({ ...prev, [accountId]: newOrder }));
  localStorage.setItem(
    `${CALENDAR_ORDER_KEY_PREFIX}${accountId}`,
    JSON.stringify(newOrder)
  );
}

/**
 * Set the default calendar for new events
 * Persists to localStorage
 */
export function setDefaultCalendar(calendarId: string): void {
  setDefaultCalendarId(calendarId);
  localStorage.setItem(DEFAULT_CALENDAR_KEY, calendarId);
}

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

    // Load default calendar from localStorage and validate it exists
    const savedDefaultId = localStorage.getItem(DEFAULT_CALENDAR_KEY);
    if (savedDefaultId) {
      const calendarExists = accounts.some((account) =>
        account.calendars.some((cal) => cal.id === savedDefaultId)
      );
      if (calendarExists) {
        setDefaultCalendarId(savedDefaultId);
      } else {
        // Default calendar was deleted, clear the saved value
        localStorage.removeItem(DEFAULT_CALENDAR_KEY);
      }
    }

    // Load account order from localStorage
    const savedOrder = localStorage.getItem(ACCOUNT_ORDER_KEY);
    if (savedOrder) {
      try {
        const order = JSON.parse(savedOrder);
        // Filter to only include accounts that still exist
        const validOrder = order.filter((id: string) =>
          accounts.some((a) => a.id === id)
        );
        setAccountOrder(validOrder);
      } catch {
        // Invalid JSON, ignore
      }
    }

    // Load calendar orders from localStorage for each account
    const calOrders: Record<string, string[]> = {};
    for (const account of accounts) {
      const savedCalOrder = localStorage.getItem(
        `${CALENDAR_ORDER_KEY_PREFIX}${account.id}`
      );
      if (savedCalOrder) {
        try {
          const order = JSON.parse(savedCalOrder);
          // Filter to only include calendars that still exist
          const validOrder = order.filter((id: string) =>
            account.calendars.some((c) => c.id === id)
          );
          if (validOrder.length > 0) {
            calOrders[account.id] = validOrder;
          }
        } catch {
          // Invalid JSON, ignore
        }
      }
    }
    if (Object.keys(calOrders).length > 0) {
      setCalendarOrders(calOrders);
    }
  } catch (error) {
    console.error("Failed to load accounts:", error);
  }
}

/**
 * Start the OAuth flow to add a new calendar account
 * This opens the browser, waits for authorization, and returns the account
 * Multiple flows can run concurrently - each gets its own port
 */
export async function addAccount(): Promise<void> {
  setAuthError(null);

  try {
    // The OAuth flow runs in the backend and returns the account
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
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    // Silently ignore timeout errors - user likely closed the window to restart
    if (errorMessage.includes("timed out")) {
      console.log("OAuth flow timed out (likely user cancelled to retry)");
      return;
    }

    console.error("Failed to add account:", error);
    setAuthError(errorMessage || "Failed to add account");
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
