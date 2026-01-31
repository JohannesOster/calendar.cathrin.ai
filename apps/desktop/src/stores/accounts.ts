import { createSignal, createMemo } from "solid-js";
import { startServerOAuth, isAuthenticated, onAuthComplete } from "./auth";
import { apiFetch } from "../lib/api";
import { refreshEvents } from "./events";
import type { ApiAccount, ApiCalendar } from "@cathrin/shared-types";

/**
 * Response format from the calendars API
 */
interface AccountCalendarsResult {
  accountId: string;
  calendars: ApiCalendar[];
  error?: string;
}

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

// Visibility storage key prefix
const CALENDAR_VISIBILITY_KEY_PREFIX = "calendar-visibility-";

/**
 * Load calendar visibility preferences from localStorage
 */
function getCalendarVisibility(calendarId: string): boolean {
  const saved = localStorage.getItem(
    `${CALENDAR_VISIBILITY_KEY_PREFIX}${calendarId}`,
  );
  // Default to visible if not set
  return saved === null ? true : saved === "true";
}

/**
 * Save calendar visibility preference to localStorage
 */
function setCalendarVisibilityLocal(
  calendarId: string,
  visible: boolean,
): void {
  localStorage.setItem(
    `${CALENDAR_VISIBILITY_KEY_PREFIX}${calendarId}`,
    String(visible),
  );
}

/**
 * Fetch accounts and calendars from the sync server
 */
async function fetchAccountsFromServer(): Promise<CalendarAccount[]> {
  // Fetch accounts and calendars in parallel
  const [accounts, calendarsResponse] = await Promise.all([
    apiFetch<ApiAccount[]>("/api/accounts"),
    apiFetch<AccountCalendarsResult[]>("/api/calendars"),
  ]);

  // Build calendars map by account
  const calendarsByAccount = new Map<string, Calendar[]>();
  for (const result of calendarsResponse) {
    calendarsByAccount.set(
      result.accountId,
      result.calendars.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
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
  }));
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
    const accounts = await fetchAccountsFromServer();
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

    // Reload ordering preferences from localStorage
    const savedOrder = localStorage.getItem(ACCOUNT_ORDER_KEY);
    if (savedOrder) {
      try {
        const order = JSON.parse(savedOrder);
        const validOrder = order.filter((id: string) =>
          accounts.some((a) => a.id === id),
        );
        setAccountOrder(validOrder);
      } catch {
        // Invalid JSON, ignore
      }
    }

    // Reload calendar orders
    const calOrders: Record<string, string[]> = {};
    for (const account of accounts) {
      const savedCalOrder = localStorage.getItem(
        `${CALENDAR_ORDER_KEY_PREFIX}${account.id}`,
      );
      if (savedCalOrder) {
        try {
          const order = JSON.parse(savedCalOrder);
          const validOrder = order.filter((id: string) =>
            account.calendars.some((c) => c.id === id),
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
    console.error("Failed to reload accounts:", error);
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
  setCalendarVisibilityLocal(calendarId, visible);

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

// Register callback to reload accounts when auth completes
// This handles both initial login and adding additional accounts
onAuthComplete(async () => {
  await reloadAccounts();
  // Also refresh events to fetch data from the new account
  refreshEvents();
});
