import { onMount, createEffect } from "solid-js";
import { Plus } from "lucide-solid";
import { addAccount } from "../../stores/accounts";
import { initializeSidebarUI, persistCollapsedAccounts, collapsedAccounts } from "../../stores/sidebar-ui";
import { SIDEBAR } from "../../constants/sidebar";
import { SearchInput } from "./SearchInput";
import { MiniCalendar } from "./MiniCalendar";
import { AccountsList } from "./AccountsList";

export function LeftSidebar() {
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

      {/* Add calendar button */}
      <div class="p-3 border-t border-[#e8e8e8]">
        <button
          onClick={() => addAccount()}
          class="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-[#91918e] hover:text-[#37352f] hover:bg-[#efefef] rounded transition-colors"
        >
          <Plus size={SIDEBAR.ICON_LG} />
          <span>Add calendar account</span>
        </button>
      </div>
    </div>
  );
}
