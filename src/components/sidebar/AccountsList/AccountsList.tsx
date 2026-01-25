import { createSignal, createEffect, For, Show } from "solid-js";
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  useDragDropContext,
  type Id,
  type DragEvent,
} from "@thisbeyond/solid-dnd";
import { createAutoAnimate } from "@formkit/auto-animate/solid";
import { ChevronDown, Eye, EyeOff, MoreHorizontal, X } from "lucide-solid";
import {
  authError,
  setAuthError,
  orderedAccounts,
  orderedAccountIds,
  setAccountOrderAndPersist,
  updateCalendarVisibility,
  refreshAccount,
  deleteAccount,
  getOrderedCalendars,
  getOrderedCalendarIds,
  setCalendarOrderAndPersist,
  defaultCalendarId,
  type CalendarAccount,
  type Calendar,
} from "../../../stores/accounts";
import {
  isAccountCollapsed,
  toggleAccountCollapse,
  getAccountMenuOpen,
  toggleAccountMenu,
  closeAccountMenu,
} from "../../../stores/sidebar-ui";
import { SIDEBAR } from "../../../constants/sidebar";
import { createTriggerZoneCollisionDetector, type SwapRecord } from "./collisionDetector";
import { SortableAccountItem } from "./SortableAccountItem";

// Type to track what kind of item is being dragged
type DragType = "account" | "calendar";

interface CalendarDragInfo {
  accountId: string;
  calendar: Calendar;
}

export function AccountsList() {
  const [activeId, setActiveId] = createSignal<Id | null>(null);
  const [dragType, setDragType] = createSignal<DragType | null>(null);
  // Track order during drag (not persisted until drag ends)
  const [dragOrder, setDragOrder] = createSignal<string[] | null>(null);
  // Track calendar order during drag for a specific account
  const [calendarDragAccountId, setCalendarDragAccountId] = createSignal<
    string | null
  >(null);
  const [calendarDragOrder, setCalendarDragOrder] = createSignal<
    string[] | null
  >(null);
  // Track the last swap to implement hysteresis for accounts
  let lastSwap: SwapRecord | null = null;

  // Use drag order during drag, otherwise use persisted order
  const displayOrder = () => dragOrder() ?? orderedAccountIds();

  // Get calendar display order for an account
  const getCalendarDisplayOrder = (accountId: string) => {
    if (calendarDragAccountId() === accountId && calendarDragOrder()) {
      return calendarDragOrder()!;
    }
    return getOrderedCalendarIds(accountId);
  };

  // Get ordered calendars for an account during display
  const getDisplayCalendars = (accountId: string): Calendar[] => {
    const order = getCalendarDisplayOrder(accountId);
    const calendars = getOrderedCalendars(accountId);
    // Sort by display order
    return order
      .map((id) => calendars.find((c) => c.id === id))
      .filter((c): c is Calendar => c !== undefined);
  };

  // Determine if a draggable ID is an account or calendar
  const isAccountId = (id: string): boolean => {
    return orderedAccounts().some((a) => a.id === id);
  };

  // Get the active account for the drag overlay
  const activeAccount = () => {
    const id = activeId();
    if (!id || dragType() !== "account") return null;
    return orderedAccounts().find((a) => a.id === id) ?? null;
  };

  // Get the active calendar for the drag overlay
  const activeCalendarInfo = (): CalendarDragInfo | null => {
    const id = activeId();
    const accountId = calendarDragAccountId();
    if (!id || dragType() !== "calendar" || !accountId) return null;

    const account = orderedAccounts().find((a) => a.id === accountId);
    if (!account) return null;

    const calendar = account.calendars.find((c) => c.id === id);
    if (!calendar) return null;

    return { accountId, calendar };
  };

  // Create collision detector with hysteresis for accounts
  const collisionDetector = createTriggerZoneCollisionDetector(
    isAccountId,
    () => lastSwap
  );

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

  const handleRemoveAccount = async (accountId: string) => {
    try {
      await deleteAccount(accountId);
      closeAccountMenu();
    } catch (error) {
      console.error("Failed to remove account:", error);
    }
  };

  const handleRefreshAccount = async (accountId: string) => {
    try {
      await refreshAccount(accountId);
      closeAccountMenu();
    } catch (error) {
      console.error("Failed to refresh account:", error);
    }
  };

  const onDragStart = (event: DragEvent) => {
    const id = event.draggable.id as string;
    setActiveId(id);
    lastSwap = null; // Reset hysteresis on drag start

    if (isAccountId(id)) {
      // Dragging an account
      setDragType("account");
      setDragOrder([...orderedAccountIds()]);
    } else {
      // Dragging a calendar - find which account it belongs to
      setDragType("calendar");
      const account = orderedAccounts().find((a) =>
        a.calendars.some((c) => c.id === id)
      );
      if (account) {
        setCalendarDragAccountId(account.id);
        setCalendarDragOrder([...getOrderedCalendarIds(account.id)]);
      }
    }
  };

  const onDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event;
    if (!droppable) return;

    const currentDragType = dragType();

    if (currentDragType === "account") {
      // Account drag logic
      const currentOrder = dragOrder();
      if (!currentOrder) return;

      const fromIndex = currentOrder.indexOf(draggable.id as string);
      const toIndex = currentOrder.indexOf(droppable.id as string);

      if (fromIndex !== toIndex && fromIndex !== -1 && toIndex !== -1) {
        // Record this swap for hysteresis
        const draggableY = draggable.transformed?.y ?? draggable.layout?.y ?? 0;
        lastSwap = {
          fromId: draggable.id as string,
          toId: droppable.id as string,
          pointerY: draggableY,
          direction: fromIndex < toIndex ? "down" : "up",
        };

        const newOrder = [...currentOrder];
        const [removed] = newOrder.splice(fromIndex, 1);
        newOrder.splice(toIndex, 0, removed);
        setDragOrder(newOrder);
      }
    } else if (currentDragType === "calendar") {
      // Calendar drag logic - only within the same account
      const currentOrder = calendarDragOrder();
      if (!currentOrder) return;

      const fromIndex = currentOrder.indexOf(draggable.id as string);
      const toIndex = currentOrder.indexOf(droppable.id as string);

      if (fromIndex !== toIndex && fromIndex !== -1 && toIndex !== -1) {
        const newOrder = [...currentOrder];
        const [removed] = newOrder.splice(fromIndex, 1);
        newOrder.splice(toIndex, 0, removed);
        setCalendarDragOrder(newOrder);
      }
    }
  };

  const onDragEnd = (_event: DragEvent) => {
    const currentDragType = dragType();

    if (currentDragType === "account") {
      // Persist account order
      const finalOrder = dragOrder();
      if (finalOrder) {
        const originalOrder = orderedAccountIds();
        const orderChanged = finalOrder.some((id, i) => id !== originalOrder[i]);
        if (orderChanged) {
          setAccountOrderAndPersist(finalOrder);
        }
      }
      setDragOrder(null);
    } else if (currentDragType === "calendar") {
      // Persist calendar order for the account
      const accountId = calendarDragAccountId();
      const finalOrder = calendarDragOrder();
      if (accountId && finalOrder) {
        const originalOrder = getOrderedCalendarIds(accountId);
        const orderChanged = finalOrder.some((id, i) => id !== originalOrder[i]);
        if (orderChanged) {
          setCalendarOrderAndPersist(accountId, finalOrder);
        }
      }
      setCalendarDragAccountId(null);
      setCalendarDragOrder(null);
    }

    setActiveId(null);
    setDragType(null);
    lastSwap = null; // Reset hysteresis on drag end
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
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        collisionDetector={collisionDetector}
      >
        <DragDropSensors />
        <SortableProvider ids={displayOrder()}>
          <SortableAccountsList
            displayOrder={displayOrder}
            handleRefreshAccount={handleRefreshAccount}
            handleRemoveAccount={handleRemoveAccount}
            handleToggleCalendarVisibility={handleToggleCalendarVisibility}
            getCalendarDisplayOrder={getCalendarDisplayOrder}
            getDisplayCalendars={getDisplayCalendars}
            calendarDragOrder={calendarDragOrder}
          />
        </SortableProvider>
        <DragOverlay class="z-[9999]">
          {/* Account drag overlay */}
          <Show when={activeAccount()}>
            {(account) => (
              <div class="opacity-60 bg-white rounded-md shadow-lg px-2 py-1.5 w-56 border border-[#e8e8e8]">
                <div class="flex items-center gap-1">
                  <span class="text-xs font-medium text-[#91918e] truncate flex-1">
                    {account().email}
                  </span>
                  <ChevronDown size={SIDEBAR.ICON_MD} class="text-[#91918e] flex-shrink-0" />
                  <MoreHorizontal size={SIDEBAR.ICON_MD} class="text-[#91918e] flex-shrink-0" />
                </div>
              </div>
            )}
          </Show>
          {/* Calendar drag overlay */}
          <Show when={activeCalendarInfo()}>
            {(info) => {
              const calendar = () => info().calendar;
              const isDefault = () => defaultCalendarId() === calendar().id;
              return (
                <div class="opacity-60 bg-white rounded-md shadow-lg px-2 py-1.5 w-52 border border-[#e8e8e8]">
                  <div class="flex items-center gap-2">
                    {/* Color swatch */}
                    <div
                      class="w-3 h-3 rounded flex-shrink-0"
                      style={{
                        "background-color": calendar().color,
                        "box-shadow": isDefault()
                          ? `0 0 0 2px white, 0 0 0 4px ${calendar().color}`
                          : undefined,
                      }}
                    />
                    {/* Calendar name */}
                    <span
                      class="flex-1 text-sm truncate"
                      classList={{
                        "text-[#37352f]": calendar().visible,
                        "text-[#91918e] line-through": !calendar().visible,
                      }}
                    >
                      {calendar().name}
                    </span>
                    {/* Default badge */}
                    <Show when={isDefault()}>
                      <span class="text-xs text-[#91918e]">Default</span>
                    </Show>
                    {/* Visibility icon */}
                    {calendar().visible ? (
                      <Eye size={SIDEBAR.ICON_MD} class="text-[#91918e] flex-shrink-0" />
                    ) : (
                      <EyeOff size={SIDEBAR.ICON_MD} class="text-[#91918e] flex-shrink-0" />
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

// Props for the inner sortable list
interface SortableAccountsListProps {
  displayOrder: () => string[];
  handleRefreshAccount: (accountId: string) => Promise<void>;
  handleRemoveAccount: (accountId: string) => Promise<void>;
  handleToggleCalendarVisibility: (
    accountId: string,
    calendarId: string,
    currentVisible: boolean
  ) => void;
  getCalendarDisplayOrder: (accountId: string) => string[];
  getDisplayCalendars: (accountId: string) => Calendar[];
  calendarDragOrder: () => string[] | null;
}

/**
 * Inner list component - renders items based on display order
 */
function SortableAccountsList(props: SortableAccountsListProps) {
  const [, { recomputeLayouts }] = useDragDropContext()!;
  const [animateParent] = createAutoAnimate({ duration: 150 });

  // Get accounts in display order
  const displayAccounts = () => {
    const order = props.displayOrder();
    const accounts = orderedAccounts();
    return order
      .map((id) => accounts.find((a) => a.id === id))
      .filter((a): a is CalendarAccount => a !== undefined);
  };

  // Recompute layouts when order changes to keep collision detection accurate
  createEffect(() => {
    props.displayOrder(); // Track account order changes
    props.calendarDragOrder(); // Track calendar order changes during drag
    requestAnimationFrame(() => {
      recomputeLayouts();
    });
  });

  return (
    <div ref={animateParent} class="flex flex-col gap-1">
      <For each={displayAccounts()}>
        {(account) => (
          <SortableAccountItem
            account={account}
            isCollapsed={isAccountCollapsed(account.id)}
            toggleCollapse={() => toggleAccountCollapse(account.id)}
            menuOpen={getAccountMenuOpen() === account.id}
            toggleMenu={() => toggleAccountMenu(account.id)}
            closeMenu={closeAccountMenu}
            onRefresh={() => props.handleRefreshAccount(account.id)}
            onRemove={() => props.handleRemoveAccount(account.id)}
            onToggleCalendarVisibility={props.handleToggleCalendarVisibility}
            orderedCalendarIds={() => props.getCalendarDisplayOrder(account.id)}
            orderedCalendars={() => props.getDisplayCalendars(account.id)}
          />
        )}
      </For>
    </div>
  );
}
