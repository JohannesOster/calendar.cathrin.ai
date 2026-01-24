import { createSignal, createEffect, createMemo, For, Show, onMount } from "solid-js";
import { centerDate, setCenterDate, setFlashDate, visibleStartDate } from "../calendar/CalendarGrid";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  MoreHorizontal,
  Plus,
  RotateCcw,
  RefreshCw,
  Trash2,
  X,
} from "lucide-solid";
import {
  authError,
  addAccount,
  deleteAccount,
  updateCalendarVisibility,
  refreshAccount,
  setAuthError,
  defaultCalendarId,
  setDefaultCalendar,
  orderedAccounts,
  orderedAccountIds,
  setAccountOrderAndPersist,
  type CalendarAccount,
} from "../../stores/accounts";
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  SortableProvider,
  createSortable,
  useDragDropContext,
  type Id,
  type DragEvent,
  type Droppable,
  type CollisionDetector,
} from "@thisbeyond/solid-dnd";

export function LeftSidebar() {
  const [searchQuery, setSearchQuery] = createSignal("");
  const [currentMonth, setCurrentMonth] = createSignal(
    new Date(centerDate().getFullYear(), centerDate().getMonth(), 1)
  );
  const [accountMenuOpen, setAccountMenuOpen] = createSignal<string | null>(null);
  const [collapsedAccounts, setCollapsedAccounts] = createSignal<Set<string>>(new Set());

  // Initialize collapsed accounts from localStorage
  onMount(() => {
    const saved = localStorage.getItem("sidebar-collapsed-accounts");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setCollapsedAccounts(new Set(parsed));
        }
      } catch {
        // Ignore invalid JSON
      }
    }
  });

  // Persist collapsed accounts to localStorage
  createEffect(() => {
    const collapsed = collapsedAccounts();
    localStorage.setItem("sidebar-collapsed-accounts", JSON.stringify([...collapsed]));
  });

  const toggleAccountCollapse = (accountId: string) => {
    setCollapsedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  };

  const isAccountCollapsed = (accountId: string) => collapsedAccounts().has(accountId);

  interface DayInfo {
    day: number;
    date: Date;
    isCurrentMonth: boolean;
  }

  // Get weeks for the month view, including days from adjacent months
  const getWeeksInMonth = (date: Date): DayInfo[][] => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay(); // 0 = Sunday

    const weeks: DayInfo[][] = [];
    let currentWeek: DayInfo[] = [];

    // Add days from previous month to fill the first week
    if (startingDay > 0) {
      const prevMonthLastDay = new Date(year, month, 0).getDate();
      for (let i = startingDay - 1; i >= 0; i--) {
        const day = prevMonthLastDay - i;
        currentWeek.push({
          day,
          date: new Date(year, month - 1, day),
          isCurrentMonth: false,
        });
      }
    }

    // Add days of the current month
    for (let i = 1; i <= daysInMonth; i++) {
      currentWeek.push({
        day: i,
        date: new Date(year, month, i),
        isCurrentMonth: true,
      });

      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }

    // Add days from next month to fill the last week
    let nextMonthDay = 1;
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) {
        currentWeek.push({
          day: nextMonthDay,
          date: new Date(year, month + 1, nextMonthDay),
          isCurrentMonth: false,
        });
        nextMonthDay++;
      }
      weeks.push(currentWeek);
    }

    // Always show 6 rows for consistent height
    while (weeks.length < 6) {
      const extraWeek: DayInfo[] = [];
      for (let i = 0; i < 7; i++) {
        extraWeek.push({
          day: nextMonthDay,
          date: new Date(year, month + 1, nextMonthDay),
          isCurrentMonth: false,
        });
        nextMonthDay++;
      }
      weeks.push(extraWeek);
    }

    return weeks;
  };

  const formatMonthYear = (date: Date) => {
    return date.toLocaleString("default", { month: "long", year: "numeric" });
  };

  const prevMonth = () => {
    const date = new Date(currentMonth());
    date.setMonth(date.getMonth() - 1);
    setCurrentMonth(date);
  };

  const nextMonth = () => {
    const date = new Date(currentMonth());
    date.setMonth(date.getMonth() + 1);
    setCurrentMonth(date);
  };

  // Check if mini calendar is showing the current month
  const isCurrentMonthView = () => {
    const today = new Date();
    return (
      currentMonth().getMonth() === today.getMonth() &&
      currentMonth().getFullYear() === today.getFullYear()
    );
  };

  // Go to today - navigate to show this week (Sunday first), flash today
  const goToToday = () => {
    const today = new Date();
    const weekStart = getSundayOfWeek(today);
    setCenterDate(weekStart);
    setFlashDate(today);
    // Clear after effects have captured the flash, prevents re-triggering on scroll
    setTimeout(() => setFlashDate(null), 50);
  };

  const isTodayDate = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const handleToggleCalendarVisibility = async (accountId: string, calendarId: string, currentVisible: boolean) => {
    try {
      await updateCalendarVisibility(accountId, calendarId, !currentVisible);
    } catch (error) {
      console.error("Failed to toggle calendar visibility:", error);
    }
  };

  const handleRemoveAccount = async (accountId: string) => {
    try {
      await deleteAccount(accountId);
      setAccountMenuOpen(null);
    } catch (error) {
      console.error("Failed to remove account:", error);
    }
  };

  const handleRefreshAccount = async (accountId: string) => {
    try {
      await refreshAccount(accountId);
      setAccountMenuOpen(null);
    } catch (error) {
      console.error("Failed to refresh account:", error);
    }
  };

  // Get Sunday of any week
  const getSundayOfWeek = (date: Date): Date => {
    const result = new Date(date);
    result.setDate(date.getDate() - date.getDay());
    return result;
  };

  // Compute the visible date range as timestamps for efficient comparison
  const visibleRange = createMemo(() => {
    const startDate = new Date(visibleStartDate());
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    endDate.setHours(23, 59, 59, 999);
    return { start: startDate.getTime(), end: endDate.getTime() };
  });

  // Handle day click - navigate main grid to show the week (Sunday first), flash the clicked day
  const handleDayClick = (dayInfo: DayInfo) => {
    const weekStart = getSundayOfWeek(dayInfo.date);
    setCenterDate(weekStart);
    setFlashDate(dayInfo.date);
    // Clear after effects have captured the flash, prevents re-triggering on scroll
    setTimeout(() => setFlashDate(null), 50);
  };

  // Track previous centerDate to detect external navigation changes
  let prevCenterDate = centerDate();

  // Sync mini calendar month only when centerDate changes (not on manual month browsing)
  createEffect(() => {
    const center = centerDate();
    // Only sync if centerDate actually changed (external navigation)
    if (
      center.getTime() !== prevCenterDate.getTime()
    ) {
      prevCenterDate = center;
      // Update mini calendar month to show the new active week
      if (
        center.getMonth() !== currentMonth().getMonth() ||
        center.getFullYear() !== currentMonth().getFullYear()
      ) {
        setCurrentMonth(new Date(center.getFullYear(), center.getMonth(), 1));
      }
    }
  });

  return (
    <div class="h-full flex flex-col overflow-hidden">
      {/* Search section */}
      <div class="p-3 border-b border-[#e8e8e8]">
        <div class="relative">
          <Search
            size={16}
            class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#91918e]"
          />
          <input
            type="text"
            placeholder="Search events"
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            class="w-full pl-8 pr-3 py-1.5 text-sm bg-[#f1f1ef] rounded-md border-none outline-none placeholder:text-[#91918e] text-[#37352f] focus:ring-2 focus:ring-[#2383e2] focus:ring-opacity-50"
          />
        </div>
      </div>

      {/* Mini Calendar */}
      <div class="p-2 border-b border-[#e8e8e8]">
        {/* Month navigation */}
        <div class="flex items-center justify-between mb-2 px-1.5">
          <span class="text-sm font-medium text-[#37352f]">
            {formatMonthYear(currentMonth())}
          </span>
          <div class="flex items-center gap-1">
            <Show when={!isCurrentMonthView()}>
              <button
                onClick={goToToday}
                class="p-1 rounded-md hover:bg-[#efefef] text-[#91918e] hover:text-[#37352f]"
                title="Go to today"
              >
                <RotateCcw size={14} />
              </button>
            </Show>
            <button
              onClick={prevMonth}
              class="p-1 rounded-md hover:bg-[#efefef] text-[#91918e] hover:text-[#37352f]"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={nextMonth}
              class="p-1 rounded-md hover:bg-[#efefef] text-[#91918e] hover:text-[#37352f]"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {/* Weekday headers */}
        <div class="grid grid-cols-7 mb-1">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
            <div class="w-7 text-center text-xs text-[#91918e]">{day}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div class="flex flex-col gap-1">
          <For each={getWeeksInMonth(currentMonth())}>
            {(week) => {
              // Compute which days in this row are visible
              const getVisibleIndices = () => {
                const range = visibleRange();
                const indices: number[] = [];
                week.forEach((dayInfo, idx) => {
                  const checkDate = new Date(dayInfo.date);
                  checkDate.setHours(12, 0, 0, 0);
                  const dateTime = checkDate.getTime();
                  if (dateTime >= range.start && dateTime <= range.end) {
                    indices.push(idx);
                  }
                });
                return indices;
              };

              return (
                <div class="relative py-1">
                  {/* Continuous background for visible days in this row */}
                  <Show when={getVisibleIndices().length > 0}>
                    {(() => {
                      const indices = getVisibleIndices();
                      const firstIdx = Math.min(...indices);
                      const lastIdx = Math.max(...indices);
                      // Each cell is w-7 (28px), calculate left position and width
                      const left = `${(firstIdx / 7) * 100}%`;
                      const width = `${((lastIdx - firstIdx + 1) / 7) * 100}%`;
                      return (
                        <div
                          class="absolute top-0 bottom-0 bg-[#f1f1ef] rounded-md"
                          style={{ left, width }}
                        />
                      );
                    })()}
                  </Show>
                  <div class="relative grid grid-cols-7">
                    <For each={week}>
                      {(dayInfo) => {
                        const checkDate = new Date(dayInfo.date);
                        checkDate.setHours(12, 0, 0, 0);
                        const dateTime = checkDate.getTime();
                        const isToday = isTodayDate(dayInfo.date);

                        // Create reactive getters that access the memo
                        const visible = () => {
                          const range = visibleRange();
                          return dateTime >= range.start && dateTime <= range.end;
                        };

                        return (
                          <button
                            class="w-7 h-6 flex items-center justify-center text-xs transition-colors rounded"
                            classList={{
                              "text-[#37352f]": dayInfo.isCurrentMonth && !isToday,
                              "text-[#c4c4c4]": !dayInfo.isCurrentMonth && !visible(),
                              "text-[#91918e]": !dayInfo.isCurrentMonth && visible() && !isToday,
                              "bg-[#2383e2] text-white hover:bg-[#2383e2]": isToday,
                              "hover:bg-[#e3e3e3]": !isToday && !visible(),
                              "hover:bg-[#e5e5e3]": !isToday && visible(),
                            }}
                            onClick={() => handleDayClick(dayInfo)}
                          >
                            {dayInfo.day}
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </div>

      {/* Calendar Accounts List */}
      <div class="flex-1 overflow-y-scroll scrollbar-hidden p-2">
        {/* Auth error message */}
        <Show when={authError()}>
          <div class="mb-3 p-2 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
            <span class="flex-1 text-xs text-red-600">{authError()}</span>
            <button
              onClick={() => setAuthError(null)}
              class="p-0.5 rounded hover:bg-red-100 text-red-400"
            >
              <X size={12} />
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

        <AccountsList
          isAccountCollapsed={isAccountCollapsed}
          toggleAccountCollapse={toggleAccountCollapse}
          accountMenuOpen={accountMenuOpen}
          setAccountMenuOpen={setAccountMenuOpen}
          handleRefreshAccount={handleRefreshAccount}
          handleRemoveAccount={handleRemoveAccount}
          handleToggleCalendarVisibility={handleToggleCalendarVisibility}
        />
      </div>

      {/* Add calendar button */}
      <div class="p-3 border-t border-[#e8e8e8]">
        <button
          onClick={() => addAccount()}
          class="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-[#91918e] hover:text-[#37352f] hover:bg-[#efefef] rounded transition-colors"
        >
          <Plus size={16} />
          <span>Add calendar account</span>
        </button>
      </div>
    </div>
  );
}

// Props for accounts list components
interface AccountsListProps {
  isAccountCollapsed: (id: string) => boolean;
  toggleAccountCollapse: (id: string) => void;
  accountMenuOpen: () => string | null;
  setAccountMenuOpen: (id: string | null) => void;
  handleRefreshAccount: (id: string) => Promise<void>;
  handleRemoveAccount: (id: string) => Promise<void>;
  handleToggleCalendarVisibility: (
    accountId: string,
    calendarId: string,
    currentVisible: boolean
  ) => Promise<void>;
}

// Hysteresis state for preventing rapid back-and-forth swaps
interface SwapRecord {
  fromId: string;
  toId: string;
  pointerY: number;
  direction: "down" | "up"; // down = fromIndex < toIndex
}

// Accounts list with drag-and-drop support
// Uses onDragOver reordering instead of transforms to handle variable-height items
// See: https://github.com/thisbeyond/solid-dnd/issues/97
function AccountsList(props: AccountsListProps) {
  const [activeId, setActiveId] = createSignal<Id | null>(null);
  // Track order during drag (not persisted until drag ends)
  const [dragOrder, setDragOrder] = createSignal<string[] | null>(null);
  // Track the last swap to implement hysteresis
  let lastSwap: SwapRecord | null = null;
  // Minimum pixels the pointer must move past the swap point to trigger a reverse swap
  const HYSTERESIS_THRESHOLD = 20;

  // Use drag order during drag, otherwise use persisted order
  const displayOrder = () => dragOrder() ?? orderedAccountIds();

  // Get the active account for the drag overlay
  const activeAccount = () => {
    const id = activeId();
    if (!id) return null;
    return orderedAccounts().find((a) => a.id === id) ?? null;
  };

  // The placeholder shown during drag is always h-8 (32px), regardless of expanded state
  const PLACEHOLDER_HEIGHT = 32;

  // Custom collision detector with hysteresis
  // Uses intersection + closestCenter logic to prevent rapid swaps
  const hysteresisCollisionDetector: CollisionDetector = (draggable, droppables, _context) => {
    // Use transformed position (during drag) with fallback to layout
    const draggableLayout = draggable.transformed ?? draggable.layout;
    if (!draggableLayout) return null;

    // IMPORTANT: Use placeholder height (32px), not the stale transformed.height
    // When dragging an expanded account, the DOM shows a 32px placeholder,
    // but transformed.height still contains the old expanded height (250px+)
    const draggableTop = draggableLayout.y;
    const draggableBottom = draggableLayout.y + PLACEHOLDER_HEIGHT;
    const draggableCenter = draggableLayout.y + PLACEHOLDER_HEIGHT / 2;

    // Find droppables that the draggable actually OVERLAPS with
    // Then pick the one with the closest center
    let closestDroppable: Droppable | null = null;
    let minDistance = Infinity;

    for (const droppable of droppables) {
      if (droppable.id === draggable.id) continue;

      const droppableLayout = droppable.layout;
      if (!droppableLayout) continue;

      const droppableTop = droppableLayout.y;
      const droppableBottom = droppableLayout.y + droppableLayout.height;

      // Check if draggable overlaps with this droppable (vertical intersection)
      const hasOverlap = draggableBottom > droppableTop && draggableTop < droppableBottom;
      if (!hasOverlap) continue;

      const droppableCenter = droppableLayout.y + droppableLayout.height / 2;
      const distance = Math.abs(draggableCenter - droppableCenter);

      if (distance < minDistance) {
        minDistance = distance;
        closestDroppable = droppable;
      }
    }

    if (!closestDroppable) return null;

    // Check if this would be a reverse swap (swapping back with same target)
    if (lastSwap) {
      // Reverse swap = same draggable trying to swap with the same target again
      const isReverseSwap =
        lastSwap.fromId === draggable.id as string &&
        lastSwap.toId === closestDroppable.id as string;

      if (isReverseSwap) {
        // Get the current center of the target we previously swapped with
        const targetLayout = closestDroppable.layout;
        if (targetLayout) {
          const targetCenter = targetLayout.y + targetLayout.height / 2;

          // Require the draggable to move past the target's center by the threshold
          if (lastSwap.direction === "down") {
            // Original swap was downward, reverse requires moving UP past the target
            if (draggableCenter > targetCenter - HYSTERESIS_THRESHOLD) {
              return null; // Not far enough up - don't allow swap
            }
          } else {
            // Original swap was upward, reverse requires moving DOWN past the target
            if (draggableCenter < targetCenter + HYSTERESIS_THRESHOLD) {
              return null; // Not far enough down - don't allow swap
            }
          }
        }
      }
    }

    return closestDroppable;
  };

  const onDragStart = (event: DragEvent) => {
    setActiveId(event.draggable.id);
    // Initialize drag order from current order
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
      // Record this swap for hysteresis using the transformed (current) position
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
    <DragDropProvider
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      collisionDetector={hysteresisCollisionDetector}
    >
      <DragDropSensors />
      <SortableProvider ids={displayOrder()}>
        <SortableAccountsList {...props} displayOrder={displayOrder} />
      </SortableProvider>
      <DragOverlay class="z-[9999]">
        <Show when={activeAccount()}>
          {(account) => (
            <div class="opacity-60 bg-white rounded-md shadow-lg px-2 py-1.5 w-56 border border-[#e8e8e8]">
              <div class="flex items-center gap-1">
                <span class="text-xs font-medium text-[#91918e] truncate flex-1">
                  {account().email}
                </span>
                <ChevronDown size={14} class="text-[#91918e] flex-shrink-0" />
                <MoreHorizontal size={14} class="text-[#91918e] flex-shrink-0" />
              </div>
            </div>
          )}
        </Show>
      </DragOverlay>
    </DragDropProvider>
  );
}

// Inner list component - renders items based on display order
function SortableAccountsList(
  props: AccountsListProps & { displayOrder: () => string[] }
) {
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
    // Wait for DOM to update, then recompute layouts
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
            isCollapsed={props.isAccountCollapsed(account.id)}
            toggleCollapse={() => props.toggleAccountCollapse(account.id)}
            menuOpen={props.accountMenuOpen() === account.id}
            toggleMenu={() =>
              props.setAccountMenuOpen(
                props.accountMenuOpen() === account.id ? null : account.id
              )
            }
            closeMenu={() => props.setAccountMenuOpen(null)}
            onRefresh={() => props.handleRefreshAccount(account.id)}
            onRemove={() => props.handleRemoveAccount(account.id)}
            onToggleCalendarVisibility={props.handleToggleCalendarVisibility}
          />
        )}
      </For>
    </div>
  );
}

// Props for sortable account item
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
  ) => Promise<void>;
}

// Individual sortable account item
// Note: We don't use transforms for positioning - items actually reorder in the DOM
// This approach handles variable-height items correctly
function SortableAccountItem(props: SortableAccountItemProps) {
  const sortable = createSortable(props.account.id);

  return (
    <div
      ref={sortable}
      class="rounded-md"
    >
      {/* Show simple placeholder when dragging, otherwise show full content */}
      <Show
        when={!sortable.isActiveDraggable}
        fallback={
          <div class="h-8 bg-[#f0f0ee] rounded-md" />
        }
      >
      {/* Account header - draggable row */}
      <div class="group relative">
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
            {props.isCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
          {/* More menu button - separate click zone */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              props.toggleMenu();
            }}
            class="p-1 rounded hover:bg-[#d8d8d8] text-[#91918e] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          >
            <MoreHorizontal size={14} />
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
              <RefreshCw size={14} />
              Refresh
            </button>
            <button
              onClick={async () => {
                await props.onRemove();
                props.closeMenu();
              }}
              class="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 text-left"
            >
              <Trash2 size={14} />
              Remove
            </button>
          </div>
        </Show>
      </div>

      {/* Calendars - collapsible with animation */}
      <div
        class="overflow-hidden transition-[max-height,opacity] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{
          "max-height": props.isCollapsed
            ? "0px"
            : `${props.account.calendars.length * 36 + 8}px`,
          opacity: props.isCollapsed ? "0" : "1",
        }}
      >
        <div class="space-y-0.5 pt-1">
          <For each={props.account.calendars}>
            {(calendar) => {
              const isDefault = () => defaultCalendarId() === calendar.id;
              return (
                <div class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#efefef] group">
                  {/* Color indicator - clickable to set as default */}
                  <button
                    onClick={() => setDefaultCalendar(calendar.id)}
                    class="w-3 h-3 rounded flex-shrink-0 cursor-pointer transition-transform hover:scale-110"
                    style={{
                      "background-color": calendar.color,
                      "box-shadow": isDefault()
                        ? `0 0 0 2px white, 0 0 0 4px ${calendar.color}`
                        : undefined,
                    }}
                    title="Set as default calendar"
                  />

                  {/* Calendar name */}
                  <span
                    class="flex-1 text-sm truncate"
                    classList={{
                      "text-[#37352f]": calendar.visible,
                      "text-[#91918e] line-through": !calendar.visible,
                    }}
                  >
                    {calendar.name}
                  </span>

                  {/* Default badge */}
                  <Show when={isDefault()}>
                    <span class="text-xs text-[#91918e]">Default</span>
                  </Show>

                  {/* Visibility toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onToggleCalendarVisibility(
                        props.account.id,
                        calendar.id,
                        calendar.visible
                      );
                    }}
                    class="p-1 rounded hover:bg-[#d8d8d8] text-[#91918e] opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    {calendar.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                </div>
              );
            }}
          </For>
        </div>
      </div>
      </Show>
    </div>
  );
}
