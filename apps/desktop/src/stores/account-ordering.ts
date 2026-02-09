import { createSignal, createMemo } from "solid-js";
import {
  connectedAccounts,
  setDefaultCalendarId,
  _registerOrderingFns,
  type Calendar,
  type CalendarAccount,
} from "./accounts";

const DEFAULT_CALENDAR_KEY = "default-calendar-id";
const ACCOUNT_ORDER_KEY = "account-order";
const CALENDAR_ORDER_KEY_PREFIX = "calendar-order-";
const CALENDAR_VISIBILITY_KEY_PREFIX = "calendar-visibility-";

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

/**
 * Load calendar visibility preferences from localStorage
 */
export function getCalendarVisibility(calendarId: string): boolean {
  const saved = localStorage.getItem(
    `${CALENDAR_VISIBILITY_KEY_PREFIX}${calendarId}`,
  );
  // Default to visible if not set
  return saved === null ? true : saved === "true";
}

/**
 * Save calendar visibility preference to localStorage
 */
export function setCalendarVisibilityLocal(
  calendarId: string,
  visible: boolean,
): void {
  localStorage.setItem(
    `${CALENDAR_VISIBILITY_KEY_PREFIX}${calendarId}`,
    String(visible),
  );
}

/**
 * Load ordering preferences from localStorage for a set of accounts.
 * Deduplicates the logic used by both initializeAccounts and reloadAccounts.
 */
export function loadOrderingPreferences(accounts: CalendarAccount[]): void {
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
}

// Register with accounts.ts so it can call our functions without importing us
// (breaking the circular dependency: account-ordering -> accounts -> account-ordering).
_registerOrderingFns({
  loadOrderingPreferences,
  setCalendarVisibilityLocal,
});
