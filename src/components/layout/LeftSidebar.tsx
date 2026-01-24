import { createSignal, createEffect, createMemo, For, Show } from "solid-js";
import { centerDate, setCenterDate, setFlashDate, visibleStartDate } from "../calendar/CalendarGrid";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from "lucide-solid";
import {
  connectedAccounts,
  isAuthenticating,
  authError,
  addAccount,
  deleteAccount,
  updateCalendarVisibility,
  refreshAccount,
  setAuthError,
} from "../../stores/accounts";

export function LeftSidebar() {
  const [searchQuery, setSearchQuery] = createSignal("");
  const [currentMonth, setCurrentMonth] = createSignal(
    new Date(centerDate().getFullYear(), centerDate().getMonth(), 1)
  );
  const [accountMenuOpen, setAccountMenuOpen] = createSignal<string | null>(null);

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

  // Check if a day is within the visible 7-day window in the main grid
  const isVisibleDay = (date: Date): boolean => {
    const range = visibleRange();
    const checkDate = new Date(date);
    checkDate.setHours(12, 0, 0, 0);
    const checkTime = checkDate.getTime();
    return checkTime >= range.start && checkTime <= range.end;
  };

  // Handle day click - navigate main grid to show the week (Sunday first), flash the clicked day
  const handleDayClick = (dayInfo: DayInfo) => {
    const weekStart = getSundayOfWeek(dayInfo.date);
    setCenterDate(weekStart);
    setFlashDate(dayInfo.date);
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
      <div class="flex-1 overflow-auto p-3">
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
        <Show when={connectedAccounts().length === 0 && !isAuthenticating()}>
          <div class="text-center py-6">
            <p class="text-sm text-[#91918e] mb-2">No calendars connected</p>
            <p class="text-xs text-[#b8b8b5]">
              Add a Google account to see your calendars
            </p>
          </div>
        </Show>

        <For each={connectedAccounts()}>
          {(account) => (
            <div class="mb-4">
              {/* Account header */}
              <div class="flex items-center justify-between mb-2 group relative">
                <span class="text-xs font-medium text-[#91918e] truncate flex-1 min-w-0">
                  {account.email}
                </span>
                <button
                  onClick={() => setAccountMenuOpen(accountMenuOpen() === account.id ? null : account.id)}
                  class="p-1 rounded hover:bg-[#efefef] text-[#91918e] opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <MoreHorizontal size={14} />
                </button>

                {/* Account dropdown menu */}
                <Show when={accountMenuOpen() === account.id}>
                  <div class="absolute right-0 top-6 z-10 bg-white border border-[#e8e8e8] rounded-md shadow-lg py-1 min-w-[140px]">
                    <button
                      onClick={() => handleRefreshAccount(account.id)}
                      class="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-[#37352f] hover:bg-[#efefef] text-left"
                    >
                      <RefreshCw size={14} />
                      Refresh
                    </button>
                    <button
                      onClick={() => handleRemoveAccount(account.id)}
                      class="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 text-left"
                    >
                      <Trash2 size={14} />
                      Remove
                    </button>
                  </div>
                </Show>
              </div>

              {/* Calendars */}
              <div class="space-y-0.5">
                <For each={account.calendars}>
                  {(calendar) => (
                    <div class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#efefef] group cursor-pointer">
                      {/* Color indicator */}
                      <div
                        class="w-4 h-4 rounded flex-shrink-0"
                        style={{ "background-color": calendar.color }}
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
                      {calendar.isDefault && (
                        <span class="text-xs text-[#91918e]">Default</span>
                      )}

                      {/* Visibility toggle */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleCalendarVisibility(account.id, calendar.id, calendar.visible);
                        }}
                        class="p-1 rounded hover:bg-[#d8d8d8] text-[#91918e] opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        {calendar.visible ? (
                          <Eye size={14} />
                        ) : (
                          <EyeOff size={14} />
                        )}
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>

      {/* Add calendar button */}
      <div class="p-3 border-t border-[#e8e8e8]">
        <button
          onClick={() => addAccount()}
          disabled={isAuthenticating()}
          class="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-[#91918e] hover:text-[#37352f] hover:bg-[#efefef] rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Show when={isAuthenticating()} fallback={<Plus size={16} />}>
            <Loader2 size={16} class="animate-spin" />
          </Show>
          <span>{isAuthenticating() ? "Connecting..." : "Add calendar account"}</span>
        </button>
      </div>
    </div>
  );
}
