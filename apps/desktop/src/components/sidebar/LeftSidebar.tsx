import { onMount, createEffect, createSignal, Show } from "solid-js";
import { Plus } from "lucide-solid";
import { addAccount } from "../../stores/accounts";
import { initializeSidebarUI, persistCollapsedAccounts, collapsedAccounts } from "../../stores/sidebar-ui";
import { SIDEBAR } from "../../constants/sidebar";
import { SearchInput } from "./SearchInput";
import { MiniCalendar } from "./MiniCalendar";
import { AccountsList } from "./AccountsList";

export function LeftSidebar() {
  const [showProviderMenu, setShowProviderMenu] = createSignal(false);
  let menuRef: HTMLDivElement | undefined;

  // Initialize sidebar UI state from localStorage
  onMount(() => {
    initializeSidebarUI();
  });

  // Persist collapsed accounts to localStorage when they change
  createEffect(() => {
    // Track the signal
    collapsedAccounts();
    // Persist changes
    persistCollapsedAccounts();
  });

  // Close menu on outside click
  function handleClickOutside(e: MouseEvent) {
    if (menuRef && !menuRef.contains(e.target as Node)) {
      setShowProviderMenu(false);
    }
  }

  createEffect(() => {
    if (showProviderMenu()) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }
  });

  function handleProviderSelect(provider: "google" | "outlook") {
    setShowProviderMenu(false);
    addAccount(provider);
  }

  return (
    <div class="h-full flex flex-col overflow-hidden">
      {/* Search section */}
      <SearchInput />

      {/* Mini Calendar */}
      <MiniCalendar />

      {/* Calendar Accounts List */}
      <div class="flex-1 overflow-y-scroll scrollbar-hidden p-2">
        <AccountsList />
      </div>

      {/* Add calendar button with provider selector */}
      <div class="p-3 border-t border-border relative" ref={menuRef}>
        <Show when={showProviderMenu()}>
          <div class="absolute bottom-full left-3 right-3 mb-1 bg-surface border border-border rounded-lg shadow-lg overflow-hidden z-10">
            <button
              onClick={() => handleProviderSelect("google")}
              class="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-fg hover:bg-surface-hover transition-colors"
            >
              <GoogleIcon />
              <span>Google Calendar</span>
            </button>
            <button
              onClick={() => handleProviderSelect("outlook")}
              class="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-fg hover:bg-surface-hover transition-colors"
            >
              <OutlookIcon />
              <span>Outlook Calendar</span>
            </button>
          </div>
        </Show>
        <button
          onClick={() => setShowProviderMenu((v) => !v)}
          class="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-fg-muted hover:text-fg hover:bg-surface-hover rounded transition-colors"
        >
          <Plus size={SIDEBAR.ICON_LG} />
          <span>Add calendar account</span>
        </button>
      </div>
    </div>
  );
}

// Simple inline SVG icons for provider branding (16x16)

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function OutlookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M24 7.387v10.478c0 .23-.08.424-.238.583a.795.795 0 0 1-.583.238h-8.86v-12.5h8.86c.23 0 .424.08.583.239.159.159.238.353.238.583v.379z" fill="#0364B8"/>
      <path d="M16.297 6.186H8.91v13.125h7.388c.23 0 .424-.08.583-.238a.795.795 0 0 0 .238-.583V6.808a.795.795 0 0 0-.238-.583.795.795 0 0 0-.583-.039z" fill="#0A2767"/>
      <path d="M14.319 6.186v12.5H8.91v-12.5h5.41z" fill="#28A8EA"/>
      <path d="M13.1 10.5c0 1.438-.437 2.574-1.31 3.41-.875.835-2.012 1.253-3.412 1.253-1.4 0-2.538-.418-3.413-1.254C4.092 13.074 3.654 11.939 3.654 10.5c0-1.438.438-2.575 1.311-3.412C5.84 6.253 6.978 5.835 8.378 5.835s2.537.418 3.412 1.253c.873.837 1.31 1.974 1.31 3.412z" fill="#0078D4"/>
      <path d="M8.378 7.594c-.858 0-1.554.293-2.088.88-.534.587-.801 1.285-.801 2.094 0 .81.267 1.505.8 2.088.535.583 1.231.875 2.09.875.857 0 1.553-.292 2.087-.875.534-.583.801-1.279.801-2.088 0-.81-.267-1.507-.8-2.094-.535-.587-1.231-.88-2.089-.88z" fill="white"/>
    </svg>
  );
}
