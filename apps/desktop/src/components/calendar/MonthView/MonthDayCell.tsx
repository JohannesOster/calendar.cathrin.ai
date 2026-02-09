import { For, Show, createMemo, batch } from "solid-js";
import { isToday, isSameDay, getSundayOfWeek } from "../../../lib/date-utils";
import { setCenterDate, setFlashDate, setNavigationTarget } from "../../../stores/calendar-navigation";
import { setCurrentView, setVisibleDaysCount } from "../../../stores/view";
import { events } from "../../../stores/events";
import { connectedAccounts } from "../../../stores/accounts";
import { MonthEventChip } from "./MonthEventChip";
import { SIDEBAR } from "../../../constants/sidebar";

// Layout constants
const DAY_NUMBER_HEIGHT = 28; // px - height reserved for day number
const CHIP_HEIGHT = 22; // px - height of each event chip
const CHIP_GAP = 2; // px - gap between chips
const CELL_PADDING = 4; // px - p-1 = 4px

// Spanning chip dimensions (must match MonthWeekRow)
export const SPANNING_CHIP_HEIGHT = 22;
export const SPANNING_CHIP_GAP = 2;

export interface DayInfo {
  day: number;
  date: Date;
  isCurrentMonth: boolean;
}

interface MonthDayCellProps {
  dayInfo: DayInfo;
  isFlashing?: boolean;
  cellHeight?: number; // Pass from parent for dynamic slot calculation
  spanningRowCount?: number; // Number of spanning event rows above timed chips
  overflowSpanningCount?: number; // Hidden spanning events to add to "+X more"
}

export function MonthDayCell(props: MonthDayCellProps) {
  const isTodayDate = () => isToday(props.dayInfo.date);
  const isFirstOfMonth = () => props.dayInfo.day === 1;

  // Navigate to week view showing the week containing the given date, with flash highlight.
  // Uses batch() because SolidJS does NOT auto-batch in event handlers — without it,
  // each setter fires effects immediately, so setCurrentView("Week") would swap the
  // <Show> and trigger scroll effects before setCenterDate/setVisibleDaysCount run.
  // Flash is delayed because the Month→Week transition takes ~3 RAFs to restore scroll
  // position and render the correct DayColumn components.
  const navigateToWeekView = (date: Date) => {
    const weekStart = getSundayOfWeek(date);
    batch(() => {
      setNavigationTarget(weekStart);
      setCenterDate(weekStart);
      setCurrentView("Week");
      setVisibleDaysCount(7);
    });
    setTimeout(() => {
      setFlashDate(date);
      setTimeout(() => setFlashDate(null), SIDEBAR.FLASH_CLEAR_DELAY);
    }, 100);
  };

  // Get visible calendar IDs (same pattern as DayColumn)
  const visibleCalendarIds = () => {
    return new Set(
      connectedAccounts()
        .flatMap((a) => a.calendars)
        .filter((c) => c.visible)
        .map((c) => c.id)
    );
  };

  // Filter events for this day: must start on this day, from a visible calendar, not all-day
  // Events spanning multiple days show on their start day only (spanning is separate issue #29)
  const dayEvents = createMemo(() => {
    const visible = visibleCalendarIds();
    return events()
      .filter(
        (event) =>
          isSameDay(event.start, props.dayInfo.date) &&
          visible.has(event.calendarId) &&
          !event.isAllDay
      )
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  });

  // Calculate max visible slots based on cell height, accounting for spanning rows
  // Default to 120px (WEEK_ROW_HEIGHT from MonthView)
  const maxVisibleSlots = () => {
    const cellHeight = props.cellHeight ?? 120;
    const spanningSpace = (props.spanningRowCount ?? 0) * (SPANNING_CHIP_HEIGHT + SPANNING_CHIP_GAP);
    const availableHeight = cellHeight - DAY_NUMBER_HEIGHT - CELL_PADDING * 2 - spanningSpace;
    // Reserve 1 slot for "+X more" indicator
    const slots = Math.floor(availableHeight / (CHIP_HEIGHT + CHIP_GAP)) - 1;
    return Math.max(1, slots); // At least 1 slot
  };

  // Events to display and overflow count (includes hidden spanning events)
  const visibleEvents = () => dayEvents().slice(0, maxVisibleSlots());
  const overflowCount = () => {
    const timedOverflow = Math.max(0, dayEvents().length - maxVisibleSlots());
    return timedOverflow + (props.overflowSpanningCount ?? 0);
  };

  return (
    <div
      class="border-r border-b border-border p-1 min-h-0 flex flex-col transition-colors duration-200 overflow-hidden"
      classList={{
        "bg-accent-light": props.isFlashing,
      }}
    >
      {/* Day number - top right, clickable to navigate to week view */}
      <div class="flex justify-end shrink-0">
        <button
          onClick={() => navigateToWeekView(props.dayInfo.date)}
          class="w-7 h-7 flex items-center justify-center text-sm rounded-full cursor-pointer transition-colors"
          classList={{
            "bg-accent text-white hover:bg-accent-hover": isTodayDate(),
            "text-fg font-medium hover:bg-surface-hover": isFirstOfMonth() && !isTodayDate(),
            "text-fg hover:bg-surface-hover": !isFirstOfMonth() && !isTodayDate(),
          }}
          tabIndex={0}
        >
          {props.dayInfo.day}
        </button>
      </div>

      {/* Event chips - pushed below spanning rows */}
      <div
        class="flex flex-col gap-0.5 min-h-0"
        style={{
          "margin-top": (props.spanningRowCount ?? 0) > 0
            ? `${(props.spanningRowCount ?? 0) * (SPANNING_CHIP_HEIGHT + SPANNING_CHIP_GAP)}px`
            : undefined,
        }}
      >
        <For each={visibleEvents()}>
          {(event) => <MonthEventChip event={event} />}
        </For>

        {/* Overflow indicator - click navigates to week view */}
        <Show when={overflowCount() > 0}>
          <button
            onClick={() => navigateToWeekView(props.dayInfo.date)}
            class="text-xs text-fg-muted hover:text-fg hover:underline text-left px-1 py-0.5 cursor-pointer transition-colors"
            tabIndex={0}
          >
            +{overflowCount()} more
          </button>
        </Show>
      </div>
    </div>
  );
}
