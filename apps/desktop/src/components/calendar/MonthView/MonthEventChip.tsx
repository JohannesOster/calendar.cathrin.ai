import type { CalendarEvent } from "../../../stores/event-types";
import { formatCompactTime } from "../../../lib/format-utils";

interface MonthEventChipProps {
  event: CalendarEvent;
}

export function MonthEventChip(props: MonthEventChipProps) {
  const time = () => formatCompactTime(props.event.start);

  return (
    <div
      class="flex items-center gap-1 px-1 py-0.5 rounded-md text-xs truncate cursor-pointer hover:brightness-95 transition-[filter]"
      style={{
        "border-left": `3px solid ${props.event.color}`,
        "background-color": `${props.event.color}15`,
      }}
      tabIndex={0}
      role="button"
      aria-label={`${props.event.title} at ${time()}`}
    >
      <span class="text-fg-muted shrink-0">{time()}</span>
      <span class="truncate text-fg">{props.event.title}</span>
    </div>
  );
}
