import { Show } from "solid-js";
import type { CalendarEvent } from "../../stores/events";
import { selectEvent } from "../../stores/event-selection";
import { selectedEventId } from "../../stores/event-selection";
import { formatDateRange, formatChipTimeRange, formatTimeRange } from "../../lib/format-utils";
import { ALL_DAY_ROW_HEIGHT, CHIP_BORDER_RADIUS } from "../../constants/layout";

interface AllDayEventChipProps {
  event: CalendarEvent;
  // Positioning (calculated by parent based on layout algorithm)
  left: number; // px from left edge of all-day section
  width: number; // px width of chip
  row: number; // which row (0-indexed) for stacking
  // Visual hints for spanning
  startsBeforeView: boolean; // Event starts before visible range
  endsAfterView: boolean; // Event ends after visible range
}

export function AllDayEventChip(props: AllDayEventChipProps) {
  // Determine border radius based on spanning
  const getBorderRadius = () => {
    const left = props.startsBeforeView ? "0" : CHIP_BORDER_RADIUS;
    const right = props.endsAfterView ? "0" : CHIP_BORDER_RADIUS;
    return `${left} ${right} ${right} ${left}`;
  };

  const isSelected = () => selectedEventId() === props.event.id;

  const hasTimes = () => !props.event.isAllDay;

  const ariaLabel = () => {
    const base = `${props.event.title}, ${formatDateRange(props.event.start, props.event.end)}`;
    if (hasTimes()) return `${base}, ${formatTimeRange(props.event.start, props.event.end)}`;
    return base;
  };

  return (
    <div
      class="all-day-chip absolute flex items-center px-1.5 text-xs cursor-pointer truncate transition-[background-color]"
      classList={{ "all-day-chip--selected": isSelected() }}
      onClick={() => selectEvent(props.event.id)}
      style={{
        left: "0",
        transform: `translateX(${props.left}px)`,
        width: `${props.width}px`,
        top: `${props.row * ALL_DAY_ROW_HEIGHT + 4}px`, // 4px top padding
        height: "var(--grid-all-day-chip-height)",
        "--event-color": props.event.color,
        "border-radius": getBorderRadius(),
      }}
      data-event-id={props.event.id}
      tabIndex={0}
      role="button"
      aria-label={ariaLabel()}
    >
      <div
        class="all-day-chip__ribbon absolute left-0 top-0 bottom-0 w-[3px]"
        style={{
          "background-color": props.event.color,
          "border-radius": `${props.startsBeforeView ? "0" : CHIP_BORDER_RADIUS} 0 0 ${props.startsBeforeView ? "0" : CHIP_BORDER_RADIUS}`,
        }}
      />
      <span class="truncate text-fg ml-0.5">{props.event.title}</span>
      <Show when={hasTimes()}>
        <span class="shrink-0 text-[10px] text-fg opacity-50 ml-1">
          {formatChipTimeRange(props.event.start, props.event.end)}
        </span>
      </Show>
    </div>
  );
}
