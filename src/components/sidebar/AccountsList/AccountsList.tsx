import { createSignal, For, Show } from "solid-js";
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  closestCenter,
  type DragEvent,
} from "@thisbeyond/solid-dnd";
import { Eye, EyeOff, X } from "lucide-solid";
import {
  authError,
  setAuthError,
  orderedAccounts,
  updateCalendarVisibility,
  refreshAccount,
  deleteAccount,
  getOrderedCalendars,
  getOrderedCalendarIds,
  setCalendarOrderAndPersist,
  defaultCalendarId,
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
import { AccountItem } from "./SortableAccountItem";

export function AccountsList() {
  const [activeCalendar, setActiveCalendar] = createSignal<Calendar | null>(
    null
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
    // Force grabbing cursor globally during drag
    document.body.classList.add("dragging");

    const id = event.draggable.id as string;
    // Find the calendar being dragged
    for (const account of orderedAccounts()) {
      const calendar = account.calendars.find((c) => c.id === id);
      if (calendar) {
        setActiveCalendar(calendar);
        break;
      }
    }
  };

  const onDragEnd = (event: DragEvent) => {
    // Reset cursor
    document.body.classList.remove("dragging");

    const { draggable, droppable } = event;

    if (draggable && droppable) {
      // Find which account contains these calendars
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

    setActiveCalendar(null);
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
        collisionDetector={closestCenter}
      >
        <DragDropSensors />
        <div class="flex flex-col gap-1">
          <For each={orderedAccounts()}>
            {(account) => (
              <AccountItem
                account={account}
                isCollapsed={isAccountCollapsed(account.id)}
                toggleCollapse={() => toggleAccountCollapse(account.id)}
                menuOpen={getAccountMenuOpen() === account.id}
                toggleMenu={() => toggleAccountMenu(account.id)}
                closeMenu={closeAccountMenu}
                onRefresh={() => handleRefreshAccount(account.id)}
                onRemove={() => handleRemoveAccount(account.id)}
                onToggleCalendarVisibility={handleToggleCalendarVisibility}
                orderedCalendarIds={getOrderedCalendarIds(account.id)}
                orderedCalendars={getOrderedCalendars(account.id)}
              />
            )}
          </For>
        </div>
        <DragOverlay class="z-[9999]">
          <Show when={activeCalendar()}>
            {(calendar) => {
              const isDefault = () => defaultCalendarId() === calendar().id;
              return (
                <div class="opacity-80 bg-white rounded-md shadow-lg px-2 py-1.5 w-52 border border-[#e8e8e8]">
                  <div class="flex items-center gap-2">
                    <div
                      class="w-3 h-3 rounded flex-shrink-0"
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
                      <Eye
                        size={SIDEBAR.ICON_MD}
                        class="text-[#91918e] flex-shrink-0"
                      />
                    ) : (
                      <EyeOff
                        size={SIDEBAR.ICON_MD}
                        class="text-[#91918e] flex-shrink-0"
                      />
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
