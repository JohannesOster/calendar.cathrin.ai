import type { CalendarEvent } from "../../../stores/events";

interface MonthEventChipProps {
  event: CalendarEvent;
}

function formatCompactTime(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;

  if (minutes === 0) {
    return `${displayHour}${period}`;
  }
  return `${displayHour}:${minutes.toString().padStart(2, "0")}${period}`;
}

export function MonthEventChip(props: MonthEventChipProps) {
  const time = () => formatCompactTime(props.event.start);

  return (
    <div
      class="flex items-center gap-1 px-1 py-0.5 rounded text-xs truncate cursor-pointer hover:brightness-95 transition-[filter]"
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
