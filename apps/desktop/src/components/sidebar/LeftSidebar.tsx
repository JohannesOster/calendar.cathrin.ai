import { onMount, createEffect, createSignal, Show } from "solid-js";
import { Plus } from "lucide-solid";
import { addAccount } from "../../stores/accounts";
import { initializeSidebarUI, persistCollapsedAccounts, collapsedAccounts } from "../../stores/sidebar-ui";
import { SIDEBAR } from "../../constants/sidebar";
import { SearchInput } from "./SearchInput";
import { MiniCalendar } from "./MiniCalendar";
import { AccountsList } from "./AccountsList";
import googleIcon from "../../assets/google.svg";
import outlookIcon from "../../assets/outlook.svg";

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
              <img src={googleIcon} alt="Google" width="16" height="16" />
              <span>Google Calendar</span>
            </button>
            <button
              onClick={() => handleProviderSelect("outlook")}
              class="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-fg hover:bg-surface-hover transition-colors"
            >
              <img src={outlookIcon} alt="Outlook" width="16" height="16" />
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
