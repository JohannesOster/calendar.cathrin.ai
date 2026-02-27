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
import { X } from "lucide-solid";
import { Collapsible } from "@ark-ui/solid/collapsible";
import {
  authError,
  setAuthError,
  updateCalendarVisibility,
  defaultCalendarId,
  type Calendar,
} from "../../../stores/accounts";
import { startServerOAuth } from "../../../stores/auth";
import {
  orderedAccounts,
  setAccountOrderAndPersist,
  getOrderedCalendars,
  getOrderedCalendarIds,
  setCalendarOrderAndPersist,
} from "../../../stores/account-ordering";
import {
  isAccountCollapsed,
  toggleAccountCollapse,
} from "../../../stores/sidebar-ui";
import { SIDEBAR } from "../../../constants/sidebar";
import { SortableAccountItem } from "./SortableAccountItem";
import { SortableCalendarItem, CalendarItemContent } from "./SortableCalendarItem";

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
  const handleReconnect = (accountId: string, provider: string) => {
    // Fire-and-forget — old poll times out silently if user closes the
    // OAuth window, and they can click Reconnect again immediately.
    startServerOAuth(provider).catch((error) => {
      console.error(`Failed to reconnect account ${accountId}:`, error);
    });
  };

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
        <div class="mb-3 p-2 bg-red-950 border border-red-800 rounded-md flex items-start gap-2">
          <span class="flex-1 text-xs text-red-400">{authError()}</span>
          <button
            onClick={() => setAuthError(null)}
            class="p-0.5 rounded hover:bg-red-900 text-red-500"
          >
            <X size={SIDEBAR.ICON_SM} />
          </button>
        </div>
      </Show>

      {/* Empty state */}
      <Show when={orderedAccounts().length === 0}>
        <div class="text-center py-6">
          <p class="text-sm text-fg-muted mb-2">No calendars connected</p>
          <p class="text-xs text-fg-faint">
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
                <Collapsible.Root
                  open={!isAccountCollapsed(account.id)}
                  onOpenChange={(details) => {
                    // Only toggle if the state actually differs
                    const currentlyCollapsed = isAccountCollapsed(account.id);
                    if (details.open === currentlyCollapsed) {
                      toggleAccountCollapse(account.id);
                    }
                  }}
                >
                  {/* Sortable Account Header */}
                  <SortableAccountItem
                    account={account}
                    isCollapsed={isAccountCollapsed(account.id)}
                    toggleCollapse={() => toggleAccountCollapse(account.id)}
                    onReconnect={() => handleReconnect(account.id, account.provider)}
                  />
                  {/* Calendars - hidden during account drag or when disconnected */}
                  <Show when={!isDraggingAccounts() && account.syncStatus !== "auth_error"}>
                    <Collapsible.Content>
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
                    </Collapsible.Content>
                  </Show>
                </Collapsible.Root>
              )}
            </For>
          </SortableProvider>
        </div>
        {/* Drag overlay */}
        <DragOverlay class="z-[9999]">
          <Show when={activeItem()}>
            <div class="px-2 py-1 rounded bg-surface border border-border shadow-lg">
              <span class="text-xs font-medium text-fg-muted">
                {orderedAccounts().find((a) => a.id === activeItem())?.email}
              </span>
            </div>
          </Show>
          <Show when={activeCalendar()}>
            {(calendar) => (
              <div class="opacity-80 bg-surface rounded-md shadow-lg border border-border">
                <CalendarItemContent
                  calendar={calendar()}
                  isDefault={defaultCalendarId() === calendar().id}
                />
              </div>
            )}
          </Show>
        </DragOverlay>
      </DragDropProvider>
    </>
  );
}
