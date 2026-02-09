import { Show } from "solid-js";
import { createSortable, useDragDropContext } from "@thisbeyond/solid-dnd";
import { ChevronDown, ChevronUp, Ellipsis } from "lucide-solid";
import type { CalendarAccount } from "../../../stores/accounts";
import { SIDEBAR } from "../../../constants/sidebar";

interface AccountItemProps {
  account: CalendarAccount;
  isCollapsed: boolean;
  toggleCollapse: () => void;
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
          <div class="h-7 rounded bg-[var(--color-border)]" />
        </div>
      </Show>
      <Show when={!sortable.isActiveDraggable}>
        <div
          class="group px-2 py-1 rounded cursor-pointer hover:bg-surface-hover select-none flex items-center gap-1"
          onClick={() => props.toggleCollapse()}
        >
          <span class="text-xs font-medium text-fg-muted truncate flex-1 min-w-0">
            {props.account.email}
          </span>
          <span class="text-fg-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
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
            class="p-1 rounded hover:bg-surface-hover text-fg-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-pointer"
          >
            <Ellipsis size={SIDEBAR.ICON_MD} />
          </button>
        </div>
      </Show>
    </div>
  );
}
