import { For, Show, createMemo } from "solid-js";
import { isToday, isSameDay } from "../../../lib/date-utils";
import { events } from "../../../stores/events";
import { connectedAccounts } from "../../../stores/accounts";
import { MonthEventChip } from "./MonthEventChip";

// Layout constants
const DAY_NUMBER_HEIGHT = 28; // px - height reserved for day number
const CHIP_HEIGHT = 22; // px - height of each event chip
const CHIP_GAP = 2; // px - gap between chips
const CELL_PADDING = 4; // px - p-1 = 4px

export interface DayInfo {
  day: number;
  date: Date;
  isCurrentMonth: boolean;
}

interface MonthDayCellProps {
  dayInfo: DayInfo;
  isFlashing?: boolean;
  cellHeight?: number; // Pass from parent for dynamic slot calculation
}

export function MonthDayCell(props: MonthDayCellProps) {
  const isTodayDate = () => isToday(props.dayInfo.date);
  const isFirstOfMonth = () => props.dayInfo.day === 1;

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

  // Calculate max visible slots based on cell height
  // Default to 120px (WEEK_ROW_HEIGHT from MonthView)
  const maxVisibleSlots = () => {
    const cellHeight = props.cellHeight ?? 120;
    const availableHeight = cellHeight - DAY_NUMBER_HEIGHT - CELL_PADDING * 2;
    // Reserve 1 slot for "+X more" indicator
    const slots = Math.floor(availableHeight / (CHIP_HEIGHT + CHIP_GAP)) - 1;
    return Math.max(1, slots); // At least 1 slot
  };

  // Events to display and overflow count
  const visibleEvents = () => dayEvents().slice(0, maxVisibleSlots());
  const overflowCount = () => Math.max(0, dayEvents().length - maxVisibleSlots());

  return (
    <div
      class="border-r border-b border-[#e8e8e8] p-1 min-h-0 flex flex-col transition-colors duration-200 overflow-hidden"
      classList={{
        "bg-[#e8f4fd]": props.isFlashing,
      }}
    >
      {/* Day number - top right */}
      <div class="flex justify-end shrink-0">
        <span
          class="w-7 h-7 flex items-center justify-center text-sm rounded-full"
          classList={{
            "bg-[#2383e2] text-white": isTodayDate(),
            "text-[#37352f] font-medium": isFirstOfMonth() && !isTodayDate(),
            "text-[#37352f]": !isFirstOfMonth() && !isTodayDate(),
          }}
        >
          {props.dayInfo.day}
        </span>
      </div>

      {/* Event chips */}
      <div class="flex flex-col gap-0.5 min-h-0">
        <For each={visibleEvents()}>
          {(event) => <MonthEventChip event={event} />}
        </For>

        {/* Overflow indicator */}
        <Show when={overflowCount() > 0}>
          <button
            class="text-xs text-[#91918e] hover:text-[#37352f] text-left px-1 py-0.5 hover:bg-[#efefef] rounded transition-colors"
            tabIndex={0}
          >
            +{overflowCount()} more
          </button>
        </Show>
      </div>
    </div>
  );
}
