import { createMemo, For, Show } from "solid-js";
import { MonthDayCell, type DayInfo } from "./MonthDayCell";
import { MonthSpanningChip } from "./MonthSpanningChip";
import { calculateAllDayLayouts, type AllDayLayoutInfo } from "../../../utils/allDayLayout";
import { events } from "../../../stores/events";
import { connectedAccounts } from "../../../stores/accounts";
import { isSameDay } from "../../../lib/date-utils";

// Layout constants matching MonthDayCell
const DAY_NUMBER_HEIGHT = 28;
const SPANNING_CHIP_HEIGHT = 22;
const SPANNING_CHIP_GAP = 2;
const MAX_SPANNING_ROWS = 2;

interface MonthWeekRowProps {
  weekIndex: number;
  top: number;
  height: number;
  days: DayInfo[];
  monthLabel: string | null;
  flashDate: Date | null;
}

export function MonthWeekRow(props: MonthWeekRowProps) {
  const weekStart = () => props.days[0].date;
  const weekEnd = () => props.days[6].date;

  // Get visible calendar IDs
  const visibleCalendarIds = () => {
    return new Set(
      connectedAccounts()
        .flatMap((a) => a.calendars)
        .filter((c) => c.visible)
        .map((c) => c.id)
    );
  };

  // Filter events to visible calendars, then compute all-day layouts
  const spanningLayouts = createMemo(() => {
    const visible = visibleCalendarIds();
    const visibleEvents = events().filter((e) => visible.has(e.calendarId));
    return calculateAllDayLayouts(visibleEvents, weekStart(), weekEnd(), 7);
  });

  // Convert layouts map to renderable array with event objects
  const spanningChips = createMemo(() => {
    const layouts = spanningLayouts();
    if (layouts.size === 0) return [];

    const allEvents = events();
    const result: Array<{ event: (typeof allEvents)[0]; layout: AllDayLayoutInfo }> = [];

    for (const [eventId, layout] of layouts) {
      if (layout.row >= MAX_SPANNING_ROWS) continue;
      const event = allEvents.find((e) => e.id === eventId);
      if (event) result.push({ event, layout });
    }

    return result;
  });

  // Count of spanning rows actually used (capped)
  const spanningRowCount = createMemo(() => {
    const layouts = spanningLayouts();
    if (layouts.size === 0) return 0;
    let maxRow = 0;
    for (const layout of layouts.values()) {
      if (layout.row > maxRow) maxRow = layout.row;
    }
    return Math.min(maxRow + 1, MAX_SPANNING_ROWS);
  });

  // Per-day overflow count: spanning events hidden because they're beyond MAX_SPANNING_ROWS
  const overflowSpanningByDay = createMemo(() => {
    const layouts = spanningLayouts();
    const counts = new Array(7).fill(0) as number[];

    for (const layout of layouts.values()) {
      if (layout.row >= MAX_SPANNING_ROWS) {
        for (let col = layout.startCol; col < layout.startCol + layout.span; col++) {
          if (col >= 0 && col < 7) counts[col]++;
        }
      }
    }

    return counts;
  });

  return (
    <div
      class="absolute left-0 right-0"
      style={{
        top: `${props.top}px`,
        height: `${props.height}px`,
      }}
    >
      {/* Month label overlay */}
      <Show when={props.monthLabel}>
        <div class="absolute left-2 top-1 text-sm font-medium text-fg z-10 pointer-events-none">
          {props.monthLabel}
        </div>
      </Show>

      {/* Spanning event chips - absolutely positioned across day columns */}
      <For each={spanningChips()}>
        {(chip) => (
          <MonthSpanningChip
            event={chip.event}
            startCol={chip.layout.startCol}
            span={chip.layout.span}
            row={chip.layout.row}
            startsBeforeView={chip.layout.startsBeforeView}
            endsAfterView={chip.layout.endsAfterView}
            dayNumberHeight={DAY_NUMBER_HEIGHT}
            chipHeight={SPANNING_CHIP_HEIGHT}
            chipGap={SPANNING_CHIP_GAP}
          />
        )}
      </For>

      {/* Day cells grid */}
      <div class="grid grid-cols-7 h-full">
        <For each={props.days}>
          {(dayInfo, index) => (
            <MonthDayCell
              dayInfo={dayInfo}
              isFlashing={props.flashDate !== null && isSameDay(dayInfo.date, props.flashDate)}
              cellHeight={props.height}
              spanningRowCount={spanningRowCount()}
              overflowSpanningCount={overflowSpanningByDay()[index()]}
            />
          )}
        </For>
      </div>
    </div>
  );
}
