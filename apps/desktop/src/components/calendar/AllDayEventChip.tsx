import type { CalendarEvent } from "../../stores/events";

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

// Row height = chip height (20px) + gap (4px)
const ROW_HEIGHT = 24;

function formatDateRange(start: Date, end: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
  };
  const startStr = start.toLocaleDateString(undefined, options);
  const endStr = end.toLocaleDateString(undefined, options);

  if (startStr === endStr) {
    return startStr;
  }
  return `${startStr} – ${endStr}`;
}

export function AllDayEventChip(props: AllDayEventChipProps) {
  // Determine border radius based on spanning
  const getBorderRadius = () => {
    const left = props.startsBeforeView ? "0" : "4px";
    const right = props.endsAfterView ? "0" : "4px";
    return `${left} ${right} ${right} ${left}`;
  };

  const ariaLabel = () =>
    `${props.event.title}, ${formatDateRange(props.event.start, props.event.end)}`;

  return (
    <div
      class="absolute flex items-center px-1.5 text-xs cursor-pointer truncate transition-[filter] hover:brightness-95"
      style={{
        left: `${props.left}px`,
        width: `${props.width}px`,
        top: `${props.row * ROW_HEIGHT + 4}px`, // 4px top padding
        height: "var(--grid-all-day-chip-height)",
        "border-left": `3px solid ${props.event.color}`,
        "background-color": `${props.event.color}15`,
        "border-radius": getBorderRadius(),
      }}
      tabIndex={0}
      role="button"
      aria-label={ariaLabel()}
    >
      <span class="truncate text-[#37352f]">{props.event.title}</span>
    </div>
  );
}
