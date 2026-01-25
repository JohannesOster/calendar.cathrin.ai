import { createSignal, createEffect, For, Show } from "solid-js";
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  useDragDropContext,
  closestCenter,
  type DragEvent,
  type CollisionDetector,
} from "@thisbeyond/solid-dnd";
import { Eye, EyeOff, X } from "lucide-solid";
import {
  authError,
  setAuthError,
  orderedAccounts,
  setAccountOrderAndPersist,
  getOrderedCalendars,
  getOrderedCalendarIds,
  setCalendarOrderAndPersist,
  updateCalendarVisibility,
  defaultCalendarId,
  type Calendar,
} from "../../../stores/accounts";
import {
  isAccountCollapsed,
  toggleAccountCollapse,
  getAccountMenuOpen,
  toggleAccountMenu,
} from "../../../stores/sidebar-ui";
import { SIDEBAR } from "../../../constants/sidebar";
import { SortableAccountItem } from "./SortableAccountItem";
import { SortableCalendarItem } from "./SortableCalendarItem";

// Component that re-measures layouts when account dragging starts
function LayoutRemeasurer(props: { isDragging: () => boolean }) {
  const [, { recomputeLayouts }] = useDragDropContext()!;

  createEffect(() => {
    if (props.isDragging()) {
      // Wait for DOM to update (calendars to hide), then re-measure
      queueMicrotask(() => {
        recomputeLayouts();
      });
    }
  });

  return null;
}

export function AccountsList() {
  const [activeItem, setActiveItem] = createSignal<string | null>(null);
  const [activeCalendar, setActiveCalendar] = createSignal<Calendar | null>(null);
  const [isDraggingAccounts, setIsDraggingAccounts] = createSignal(false);

  // Simple ids accessor for accounts
  const accountIds = () => orderedAccounts().map((a) => a.id);

  // Check if an ID belongs to an account (vs a calendar)
  const isAccountId = (id: string) =>
    orderedAccounts().some((a) => a.id === id);

  // Custom collision detector that only considers droppables of the same type
  const typeFilteredCollisionDetector: CollisionDetector = (
    draggable,
    droppables,
    context
  ) => {
    const draggableType = draggable.data?.type;
    // Filter to only droppables matching the draggable's type
    const validDroppables = droppables.filter(
      (d) => d.data?.type === draggableType
    );
    if (validDroppables.length === 0) return null;
    return closestCenter(draggable, validDroppables, context);
  };

  const handleToggleCalendarVisibility = async (
    accountId: string,
    calendarId: string,
    currentVisible: boolean
  ) => {
    try {
      await updateCalendarVisibility(accountId, calendarId, !currentVisible);
    } catch (error) {
      console.error("Failed to toggle calendar visibility:", error);
    }
  };

  const onDragStart = ({ draggable }: DragEvent) => {
    document.body.classList.add("dragging");
    const id = draggable.id as string;

    // Check if dragging an account or a calendar
    if (isAccountId(id)) {
      setIsDraggingAccounts(true);
      setActiveItem(id);
    } else {
      // Find the calendar being dragged
      for (const account of orderedAccounts()) {
        const calendar = account.calendars.find((c) => c.id === id);
        if (calendar) {
          setActiveCalendar(calendar);
          break;
        }
      }
    }
  };

  const onDragEnd = ({ draggable, droppable }: DragEvent) => {
    document.body.classList.remove("dragging");

    if (draggable && droppable) {
      if (isDraggingAccounts()) {
        // Handle account reorder
        const currentItems = accountIds();
        const fromIndex = currentItems.indexOf(draggable.id as string);
        const toIndex = currentItems.indexOf(droppable.id as string);
        if (fromIndex !== toIndex) {
          const updatedItems = currentItems.slice();
          updatedItems.splice(toIndex, 0, ...updatedItems.splice(fromIndex, 1));
          setAccountOrderAndPersist(updatedItems);
        }
      } else {
        // Handle calendar reorder
        for (const account of orderedAccounts()) {
          const currentIds = getOrderedCalendarIds(account.id);
          const fromIndex = currentIds.indexOf(draggable.id as string);
          const toIndex = currentIds.indexOf(droppable.id as string);

          if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
            const updatedIds = [...currentIds];
            updatedIds.splice(toIndex, 0, ...updatedIds.splice(fromIndex, 1));
            setCalendarOrderAndPersist(account.id, updatedIds);
            break;
          }
        }
      }
    }

    setActiveItem(null);
    setActiveCalendar(null);
    setIsDraggingAccounts(false);
  };

  return (
    <>
      {/* Auth error message */}
      <Show when={authError()}>
        <div class="mb-3 p-2 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
          <span class="flex-1 text-xs text-red-600">{authError()}</span>
          <button
            onClick={() => setAuthError(null)}
            class="p-0.5 rounded hover:bg-red-100 text-red-400"
          >
            <X size={SIDEBAR.ICON_SM} />
          </button>
        </div>
      </Show>

      {/* Empty state */}
      <Show when={orderedAccounts().length === 0}>
        <div class="text-center py-6">
          <p class="text-sm text-[#91918e] mb-2">No calendars connected</p>
          <p class="text-xs text-[#b8b8b5]">
            Add a Google account to see your calendars
          </p>
        </div>
      </Show>

      <DragDropProvider
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        collisionDetector={typeFilteredCollisionDetector}
      >
        <DragDropSensors />
        <LayoutRemeasurer isDragging={isDraggingAccounts} />
        <div class="flex flex-col">
          <SortableProvider ids={accountIds()}>
            <For each={orderedAccounts()}>
              {(account) => (
                <>
                  {/* Sortable Account Header */}
                  <SortableAccountItem
                    account={account}
                    isCollapsed={isAccountCollapsed(account.id)}
                    toggleCollapse={() => toggleAccountCollapse(account.id)}
                    menuOpen={getAccountMenuOpen() === account.id}
                    toggleMenu={() => toggleAccountMenu(account.id)}
                  />
                  {/* Calendars - hidden during account drag */}
                  <Show when={!isDraggingAccounts() && !isAccountCollapsed(account.id)}>
                    <SortableProvider ids={getOrderedCalendarIds(account.id)}>
                      <For each={getOrderedCalendars(account.id)}>
                        {(calendar) => (
                          <SortableCalendarItem
                            calendar={calendar}
                            accountId={account.id}
                            onToggleVisibility={handleToggleCalendarVisibility}
                          />
                        )}
                      </For>
                    </SortableProvider>
                  </Show>
                </>
              )}
            </For>
          </SortableProvider>
        </div>
        {/* Drag overlay */}
        <DragOverlay class="z-[9999]">
          <Show when={activeItem()}>
            <div class="px-2 py-1 rounded bg-white border border-[#e8e8e8] shadow-lg">
              <span class="text-xs font-medium text-[#91918e]">
                {orderedAccounts().find((a) => a.id === activeItem())?.email}
              </span>
            </div>
          </Show>
          <Show when={activeCalendar()}>
            {(calendar) => {
              const isDefault = () => defaultCalendarId() === calendar().id;
              return (
                <div class="opacity-80 bg-white rounded-md shadow-lg px-2 py-1.5 w-52 border border-[#e8e8e8]">
                  <div class="flex items-center gap-2">
                    <div
                      class="w-3 h-3 rounded shrink-0"
                      style={{
                        "background-color": calendar().color,
                        "box-shadow": isDefault()
                          ? `0 0 0 2px white, 0 0 0 4px ${calendar().color}`
                          : undefined,
                      }}
                    />
                    <span
                      class="flex-1 text-sm truncate"
                      classList={{
                        "text-[#37352f]": calendar().visible,
                        "text-[#91918e] line-through": !calendar().visible,
                      }}
                    >
                      {calendar().name}
                    </span>
                    <Show when={isDefault()}>
                      <span class="text-xs text-[#91918e]">Default</span>
                    </Show>
                    {calendar().visible ? (
                      <Eye size={SIDEBAR.ICON_MD} class="text-[#91918e] shrink-0" />
                    ) : (
                      <EyeOff size={SIDEBAR.ICON_MD} class="text-[#91918e] shrink-0" />
                    )}
                  </div>
                </div>
              );
            }}
          </Show>
        </DragOverlay>
      </DragDropProvider>
    </>
  );
}
