import { For } from "solid-js";
import { Key } from "@solid-primitives/keyed";
import { AllDayEventChip } from "./AllDayEventChip";
import type { CalendarEvent } from "../../stores/events";

interface DaySlot {
  date: Date;
  left: number;
}

/** Layout info for an all-day event chip */
export interface AllDayEventLayout {
  event: CalendarEvent;
  left: number; // px from left edge
  width: number; // px width
  row: number; // row index (0-based)
  startsBeforeView: boolean;
  endsAfterView: boolean;
}

interface AllDaySectionProps {
  visibleDays: DaySlot[];
  colWidth: number;
  eventLayouts?: AllDayEventLayout[];
}

// Height in pixels for the all-day section (single row for now)
export const ALL_DAY_SECTION_HEIGHT = 28; // matches --grid-all-day-row-height

// Helper to create stable date key for <Key> component
const getDateKey = (date: Date): string =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

export function AllDaySection(props: AllDaySectionProps) {
  return (
    <div class="flex">
      {/* All-day label - in the time column area */}
      <div
        class="bg-white border-r border-[#e8e8e8] flex items-center justify-end pr-2"
        style={{
          width: "var(--grid-time-col-width)",
          height: `${ALL_DAY_SECTION_HEIGHT}px`,
          "flex-shrink": "0",
          position: "sticky",
          left: "0",
          "z-index": "20",
        }}
      >
        <span class="text-xs text-[#91918e]">All day</span>
      </div>

      {/* Day slots - aligned with day columns */}
      <Key each={props.visibleDays} by={(d) => getDateKey(d.date)}>
        {(item) => (
          <div
            class="absolute border-r border-[#e8e8e8] bg-white"
            style={{
              left: `${item().left}px`,
              width: `${props.colWidth}px`,
              height: `${ALL_DAY_SECTION_HEIGHT}px`,
              top: 0,
            }}
          />
        )}
      </Key>

      {/* All-day event chips */}
      <For each={props.eventLayouts}>
        {(layout) => (
          <AllDayEventChip
            event={layout.event}
            left={layout.left}
            width={layout.width}
            row={layout.row}
            startsBeforeView={layout.startsBeforeView}
            endsAfterView={layout.endsAfterView}
          />
        )}
      </For>
    </div>
  );
}
