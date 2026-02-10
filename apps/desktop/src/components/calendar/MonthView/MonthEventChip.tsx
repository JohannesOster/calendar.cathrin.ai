import type { CalendarEvent } from "../../../stores/event-types";
import { formatCompactTime } from "../../../lib/format-utils";

interface MonthEventChipProps {
  event: CalendarEvent;
}

export function MonthEventChip(props: MonthEventChipProps) {
  const time = () => formatCompactTime(props.event.start);

  return (
    <div
      class="month-event-chip flex items-center gap-1 px-1 py-0.5 rounded-md text-xs truncate cursor-pointer hover:brightness-95 transition-[filter]"
      style={{ "--event-color": props.event.color }}
      tabIndex={0}
      role="button"
      aria-label={`${props.event.title} at ${time()}`}
    >
      <span class="shrink-0 opacity-60">{time()}</span>
      <span class="truncate">{props.event.title}</span>
    </div>
  );
}
