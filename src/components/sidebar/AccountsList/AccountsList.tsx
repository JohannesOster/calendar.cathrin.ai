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
import { ChevronDown, MoreHorizontal, X } from "lucide-solid";
import {
  authError,
  setAuthError,
  orderedAccounts,
  orderedAccountIds,
  setAccountOrderAndPersist,
  updateCalendarVisibility,
  refreshAccount,
  deleteAccount,
  type CalendarAccount,
} from "../../../stores/accounts";
import {
  isAccountCollapsed,
  toggleAccountCollapse,
  getAccountMenuOpen,
  toggleAccountMenu,
  closeAccountMenu,
} from "../../../stores/sidebar-ui";
import { SIDEBAR } from "../../../constants/sidebar";
import { createHysteresisCollisionDetector, type SwapRecord } from "./collisionDetector";
import { SortableAccountItem } from "./SortableAccountItem";

export function AccountsList() {
  const [activeId, setActiveId] = createSignal<Id | null>(null);
  // Track order during drag (not persisted until drag ends)
  const [dragOrder, setDragOrder] = createSignal<string[] | null>(null);
  // Track the last swap to implement hysteresis
  let lastSwap: SwapRecord | null = null;

  // Use drag order during drag, otherwise use persisted order
  const displayOrder = () => dragOrder() ?? orderedAccountIds();

  // Get the active account for the drag overlay
  const activeAccount = () => {
    const id = activeId();
    if (!id) return null;
    return orderedAccounts().find((a) => a.id === id) ?? null;
  };

  // Create hysteresis-aware collision detector
  const collisionDetector = createHysteresisCollisionDetector(() => lastSwap);

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
    setActiveId(event.draggable.id);
    setDragOrder([...orderedAccountIds()]);
    lastSwap = null;
  };

  const onDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event;
    if (!droppable) return;

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
  };

  const onDragEnd = (_event: DragEvent) => {
    const finalOrder = dragOrder();

    // Persist the final order if it changed
    if (finalOrder) {
      const originalOrder = orderedAccountIds();
      const orderChanged = finalOrder.some((id, i) => id !== originalOrder[i]);
      if (orderChanged) {
        setAccountOrderAndPersist(finalOrder);
      }
    }

    setActiveId(null);
    setDragOrder(null);
    lastSwap = null;
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
          />
        </SortableProvider>
        <DragOverlay class="z-[9999]">
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
}

/**
 * Inner list component - renders items based on display order
 */
function SortableAccountsList(props: SortableAccountsListProps) {
  const [, { recomputeLayouts }] = useDragDropContext()!;

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
    props.displayOrder(); // Track changes
    requestAnimationFrame(() => {
      recomputeLayouts();
    });
  });

  return (
    <div class="flex flex-col gap-1">
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
          />
        )}
      </For>
    </div>
  );
}
