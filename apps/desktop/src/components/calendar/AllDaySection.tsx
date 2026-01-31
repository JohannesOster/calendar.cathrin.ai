import { For, Show, createMemo } from "solid-js";
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
  isExpanded: boolean;
  onToggleExpand: () => void;
}

// Layout constants
const ROW_HEIGHT = 24; // chip height (20px) + gap (4px)
const BASE_PADDING = 4; // top padding
const MAX_COLLAPSED_ROWS = 2;
const MIN_SECTION_HEIGHT = 28; // minimum height when empty

/**
 * Calculate section height based on row count and expanded state
 */
export function calculateAllDaySectionHeight(
  maxRow: number,
  isExpanded: boolean
): number {
  if (maxRow < 0) return MIN_SECTION_HEIGHT; // No events
  const totalRows = maxRow + 1;
  const visibleRows = isExpanded
    ? totalRows
    : Math.min(totalRows, MAX_COLLAPSED_ROWS);
  return Math.max(MIN_SECTION_HEIGHT, visibleRows * ROW_HEIGHT + BASE_PADDING);
}

// Helper to create stable date key for <Key> component
const getDateKey = (date: Date): string =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

export function AllDaySection(props: AllDaySectionProps) {
  // Calculate max row from layouts
  const maxRow = createMemo(() => {
    const layouts = props.eventLayouts ?? [];
    if (layouts.length === 0) return -1;
    return Math.max(...layouts.map((l) => l.row));
  });

  // Calculate section height
  const sectionHeight = createMemo(() =>
    calculateAllDaySectionHeight(maxRow(), props.isExpanded)
  );

  // Filter layouts to visible rows when collapsed
  const visibleLayouts = createMemo(() => {
    const layouts = props.eventLayouts ?? [];
    if (props.isExpanded) return layouts;
    return layouts.filter((l) => l.row < MAX_COLLAPSED_ROWS);
  });

  // Count hidden events
  const hiddenCount = createMemo(() => {
    const layouts = props.eventLayouts ?? [];
    if (props.isExpanded) return 0;
    return layouts.filter((l) => l.row >= MAX_COLLAPSED_ROWS).length;
  });

  // Show expand button only when there are hidden events
  const showExpandButton = () => hiddenCount() > 0 || props.isExpanded;

  return (
    <div class="flex" style={{ height: `${sectionHeight()}px` }}>
      {/* All-day label - in the time column area */}
      <div
        class="bg-white border-r border-[#e8e8e8] flex flex-col items-end justify-start pt-1 pr-2"
        style={{
          width: "var(--grid-time-col-width)",
          height: `${sectionHeight()}px`,
          "flex-shrink": "0",
          position: "sticky",
          left: "0",
          "z-index": "20",
        }}
      >
        <span class="text-xs text-[#91918e]">All day</span>

        {/* Expand/collapse button */}
        <Show when={showExpandButton()}>
          <button
            class="text-xs text-[#91918e] hover:text-[#37352f] hover:bg-[#efefef] rounded px-1 py-0.5 mt-1 transition-colors"
            onClick={props.onToggleExpand}
            tabIndex={0}
          >
            {props.isExpanded ? "less" : `+${hiddenCount()}`}
          </button>
        </Show>
      </div>

      {/* Day slots - aligned with day columns */}
      <Key each={props.visibleDays} by={(d) => getDateKey(d.date)}>
        {(item) => (
          <div
            class="absolute border-r border-[#e8e8e8] bg-white"
            style={{
              left: `${item().left}px`,
              width: `${props.colWidth}px`,
              height: `${sectionHeight()}px`,
              top: 0,
            }}
          />
        )}
      </Key>

      {/* All-day event chips */}
      <For each={visibleLayouts()}>
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
