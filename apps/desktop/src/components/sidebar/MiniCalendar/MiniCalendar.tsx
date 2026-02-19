import { createSignal, createEffect, on, createMemo, untrack, For, Show } from "solid-js";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-solid";
import { setCenterDate, setFlashDate, visibleStartDate } from "../../../stores/calendar-navigation";
import { getSundayOfWeek, formatMonthYearLocale, computeWeeksInMonth } from "../../../lib/date-utils";
import { visibleDaysCount } from "../../../stores/view";
import { SIDEBAR, WEEKDAY_LABELS } from "../../../constants/sidebar";
import type { MonthDayInfo } from "../../../lib/date-utils";
import { WeekRow } from "./WeekRow";

export function MiniCalendar() {
  const [currentMonth, setCurrentMonth] = createSignal(
    new Date(visibleStartDate().getFullYear(), visibleStartDate().getMonth(), 1)
  );

  // Memoize weeks computation
  const weeksInMonth = createMemo(() => computeWeeksInMonth(currentMonth()));

  // Compute the visible date range as timestamps for efficient comparison
  // Uses visibleDaysCount so the highlight adapts to 1-day, 3-day, 7-day, etc.
  const visibleRange = createMemo(() => {
    const startDate = new Date(visibleStartDate());
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + visibleDaysCount() - 1);
    endDate.setHours(23, 59, 59, 999);
    return { start: startDate.getTime(), end: endDate.getTime() };
  });

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
    // Always reset mini-calendar to current month (even if main grid doesn't scroll)
    setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    navigateToDate(today);
  };

  // Navigate main grid to show a date, flash that date
  // For 7-day view: snap to Sunday of the week (full week alignment)
  // For fewer days: navigate directly to the clicked date
  const navigateToDate = (date: Date) => {
    const target = visibleDaysCount() >= 7 ? getSundayOfWeek(date) : date;
    setCenterDate(target);
    setFlashDate(date);
    setTimeout(() => setFlashDate(null), SIDEBAR.FLASH_CLEAR_DELAY);
  };

  // Flag to skip auto-sync after user clicks a date
  let skipNextSync = false;

  const handleDayClick = (dayInfo: MonthDayInfo) => {
    // Skip the next auto-sync so the mini-calendar stays on the clicked date's month
    skipNextSync = true;

    // If clicking a gray day (from adjacent month), shift mini-calendar to that month
    if (!dayInfo.isCurrentMonth) {
      setCurrentMonth(new Date(dayInfo.date.getFullYear(), dayInfo.date.getMonth(), 1));
    }
    navigateToDate(dayInfo.date);
  };

  // Track previous visible date to detect scroll navigation changes
  let prevVisibleDate = visibleStartDate();

  // Sync mini calendar month when scroll position changes to a different month
  // (but not after user clicks a date - we want to preserve their intended month)
  createEffect(on(visibleStartDate, (visible) => {
    if (visible.getTime() !== prevVisibleDate.getTime()) {
      prevVisibleDate = visible;

      // Skip sync if user just clicked a date
      if (skipNextSync) {
        skipNextSync = false;
        return;
      }

      const month = untrack(currentMonth);
      if (
        visible.getMonth() !== month.getMonth() ||
        visible.getFullYear() !== month.getFullYear()
      ) {
        setCurrentMonth(new Date(visible.getFullYear(), visible.getMonth(), 1));
      }
    }
  }));

  return (
    <div class="p-2 border-b border-border select-none">
      {/* Month navigation */}
      <div class="flex items-center justify-between mb-2 px-1.5 cursor-default">
        <span class="text-sm font-medium text-fg">
          {formatMonthYearLocale(currentMonth())}
        </span>
        <div class="flex items-center gap-1">
          <Show when={!isCurrentMonthView()}>
            <button
              onClick={goToToday}
              class="p-1 rounded hover:bg-surface-hover text-fg-muted hover:text-fg"
              title="Go to today"
            >
              <RotateCcw size={SIDEBAR.ICON_MD} />
            </button>
          </Show>
          <button
            onClick={prevMonth}
            class="p-1 rounded hover:bg-surface-hover text-fg-muted hover:text-fg"
          >
            <ChevronLeft size={SIDEBAR.ICON_MD} />
          </button>
          <button
            onClick={nextMonth}
            class="p-1 rounded hover:bg-surface-hover text-fg-muted hover:text-fg"
          >
            <ChevronRight size={SIDEBAR.ICON_MD} />
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div class="grid grid-cols-7 mb-1 cursor-default">
        <For each={WEEKDAY_LABELS}>
          {(day) => (
            <div class="text-center text-xs text-fg-muted">{day}</div>
          )}
        </For>
      </div>

      {/* Calendar grid */}
      <div class="flex flex-col gap-1">
        <For each={weeksInMonth()}>
          {(week) => (
            <WeekRow
              week={week}
              visibleRange={visibleRange}
              onDayClick={handleDayClick}
            />
          )}
        </For>
      </div>
    </div>
  );
}

