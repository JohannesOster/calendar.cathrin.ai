import { For, Show } from "solid-js";
import { createSortable, SortableProvider } from "@thisbeyond/solid-dnd";
import { ChevronDown, ChevronUp, MoreHorizontal, RefreshCw, Trash2 } from "lucide-solid";
import type { CalendarAccount, Calendar } from "../../../stores/accounts";
import { SIDEBAR } from "../../../constants/sidebar";
import { SortableCalendarItem } from "./SortableCalendarItem";

interface SortableAccountItemProps {
  account: CalendarAccount;
  isCollapsed: boolean;
  toggleCollapse: () => void;
  menuOpen: boolean;
  toggleMenu: () => void;
  closeMenu: () => void;
  onRefresh: () => Promise<void>;
  onRemove: () => Promise<void>;
  onToggleCalendarVisibility: (
    accountId: string,
    calendarId: string,
    currentVisible: boolean
  ) => void;
  orderedCalendarIds: string[];
  orderedCalendars: Calendar[];
}

/**
 * Individual sortable account item
 * Note: We don't use transforms for positioning - items actually reorder in the DOM
 * This approach handles variable-height items correctly
 */
export function SortableAccountItem(props: SortableAccountItemProps) {
  const sortable = createSortable(props.account.id);

  // Compute the max-height for the calendars section
  const calendarsMaxHeight = () => {
    return `${props.account.calendars.length * SIDEBAR.CALENDAR_ROW_HEIGHT + SIDEBAR.CALENDARS_PADDING}px`;
  };

  return (
    <div class="rounded-md">
      {/* Account header - ref always attached, content conditionally shows placeholder */}
      <div ref={sortable} class="group relative">
        <Show
          when={!sortable.isActiveDraggable}
          fallback={<div class="h-8 bg-[#f0f0ee] rounded-md" />}
        >
          <div
            onMouseDown={(e) => {
              // Prevent text selection
              if ((e.target as HTMLElement).tagName !== "BUTTON") {
                e.preventDefault();
              }
            }}
            onClick={() => {
              // Don't trigger collapse while dragging
              if (!sortable.isActiveDraggable) {
                props.toggleCollapse();
              }
            }}
            class="flex items-center gap-1 px-2 py-1 rounded cursor-grab hover:bg-[#efefef] transition-colors select-none"
            classList={{
              "cursor-grabbing": sortable.isActiveDraggable,
            }}
          >
            <span class="text-xs font-medium text-[#91918e] truncate flex-1 min-w-0">
              {props.account.email}
            </span>
            {/* Chevron indicator */}
            <span class="text-[#91918e] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              {props.isCollapsed ? (
                <ChevronUp size={SIDEBAR.ICON_MD} />
              ) : (
                <ChevronDown size={SIDEBAR.ICON_MD} />
              )}
            </span>
            {/* More menu button - separate click zone */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                props.toggleMenu();
              }}
              class="p-1 rounded hover:bg-[#d8d8d8] text-[#91918e] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            >
              <MoreHorizontal size={SIDEBAR.ICON_MD} />
            </button>
          </div>

          {/* Account dropdown menu */}
          <Show when={props.menuOpen}>
            <div class="absolute right-0 top-8 z-10 bg-white border border-[#e8e8e8] rounded-md shadow-lg py-1 min-w-[140px]">
              <button
                onClick={async () => {
                  await props.onRefresh();
                  props.closeMenu();
                }}
                class="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-[#37352f] hover:bg-[#efefef] text-left"
              >
                <RefreshCw size={SIDEBAR.ICON_MD} />
                Refresh
              </button>
              <button
                onClick={async () => {
                  await props.onRemove();
                  props.closeMenu();
                }}
                class="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 text-left"
              >
                <Trash2 size={SIDEBAR.ICON_MD} />
                Remove
              </button>
            </div>
          </Show>
        </Show>
      </div>

      {/* Calendars - separate from account header, has its own SortableProvider */}
      <Show when={!sortable.isActiveDraggable}>
        <div
          class="overflow-hidden transition-[max-height,opacity] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{
            "max-height": props.isCollapsed ? "0px" : calendarsMaxHeight(),
            opacity: props.isCollapsed ? "0" : "1",
          }}
        >
          <SortableProvider ids={props.orderedCalendarIds}>
            <div class="space-y-0.5 pt-1">
              <For each={props.orderedCalendars}>
                {(calendar) => (
                  <SortableCalendarItem
                    calendar={calendar}
                    accountId={props.account.id}
                    onToggleVisibility={props.onToggleCalendarVisibility}
                  />
                )}
              </For>
            </div>
          </SortableProvider>
        </div>
      </Show>
    </div>
  );
}
