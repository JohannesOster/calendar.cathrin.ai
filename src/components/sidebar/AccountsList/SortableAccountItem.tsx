import { Show } from "solid-js";
import { createSortable, useDragDropContext } from "@thisbeyond/solid-dnd";
import { ChevronDown, ChevronUp, Ellipsis } from "lucide-solid";
import type { CalendarAccount } from "../../../stores/accounts";
import { SIDEBAR } from "../../../constants/sidebar";

interface AccountItemProps {
  account: CalendarAccount;
  isCollapsed: boolean;
  toggleCollapse: () => void;
  menuOpen: boolean;
  toggleMenu: () => void;
}

export function SortableAccountItem(props: AccountItemProps) {
  // Tag as "account" type for collision filtering
  const sortable = createSortable(props.account.id, { type: "account" });
  const [state] = useDragDropContext()!;

  return (
    <div
      // @ts-ignore - use: directive
      use:sortable
      class="rounded"
      classList={{
        "transition-transform": !!state.active.draggable,
      }}
    >
      <Show when={sortable.isActiveDraggable}>
        <div class="px-2 py-1">
          <div class="h-6 rounded bg-[#e8e8e8]" />
        </div>
      </Show>
      <Show when={!sortable.isActiveDraggable}>
        <div
          class="group px-2 py-1 rounded cursor-grab hover:bg-[#efefef] select-none flex items-center gap-1"
          onClick={() => props.toggleCollapse()}
        >
          <span class="text-xs font-medium text-[#91918e] truncate flex-1 min-w-0">
            {props.account.email}
          </span>
          <span class="text-[#91918e] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {props.isCollapsed ? (
              <ChevronUp size={SIDEBAR.ICON_MD} />
            ) : (
              <ChevronDown size={SIDEBAR.ICON_MD} />
            )}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              props.toggleMenu();
            }}
            class="p-1 rounded hover:bg-[#d8d8d8] text-[#91918e] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          >
            <Ellipsis size={SIDEBAR.ICON_MD} />
          </button>
        </div>
      </Show>
    </div>
  );
}
