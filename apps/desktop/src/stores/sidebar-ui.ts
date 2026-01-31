import { createSignal } from "solid-js";

const COLLAPSED_ACCOUNTS_KEY = "sidebar-collapsed-accounts";

// Collapsed accounts state
const [collapsedAccounts, setCollapsedAccounts] = createSignal<Set<string>>(new Set());

// Account menu state
const [accountMenuOpen, setAccountMenuOpen] = createSignal<string | null>(null);

/**
 * Check if an account is collapsed
 */
export function isAccountCollapsed(accountId: string): boolean {
  return collapsedAccounts().has(accountId);
}

/**
 * Toggle an account's collapsed state
 */
export function toggleAccountCollapse(accountId: string): void {
  setCollapsedAccounts((prev) => {
    const next = new Set(prev);
    if (next.has(accountId)) {
      next.delete(accountId);
    } else {
      next.add(accountId);
    }
    return next;
  });
}

/**
 * Toggle the account menu for a specific account
 */
export function toggleAccountMenu(accountId: string): void {
  setAccountMenuOpen((prev) => (prev === accountId ? null : accountId));
}

/**
 * Initialize collapsed accounts from localStorage
 * Should be called once on app startup
 */
export function initializeSidebarUI(): void {
  const saved = localStorage.getItem(COLLAPSED_ACCOUNTS_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        setCollapsedAccounts(new Set(parsed));
      }
    } catch {
      // Ignore invalid JSON
    }
  }
}

/**
 * Persist collapsed accounts to localStorage
 * This is called as an effect, triggered by changes to collapsedAccounts
 */
export function persistCollapsedAccounts(): void {
  const collapsed = collapsedAccounts();
  localStorage.setItem(COLLAPSED_ACCOUNTS_KEY, JSON.stringify([...collapsed]));
}

// Export raw accessors for components that need them
export { collapsedAccounts, accountMenuOpen };
