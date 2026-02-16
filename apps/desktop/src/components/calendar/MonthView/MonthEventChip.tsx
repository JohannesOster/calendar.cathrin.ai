import { Show, createMemo } from "solid-js";
import { Repeat } from "lucide-solid";
import type { CalendarEvent } from "../../../stores/event-types";
import { formatCompactTime } from "../../../lib/format-utils";

interface MonthEventChipProps {
  event: CalendarEvent;
}

export function MonthEventChip(props: MonthEventChipProps) {
  const time = () => formatCompactTime(props.event.start);
  const selfResponse = createMemo(() => props.event.attendees?.find(a => a.isSelf)?.responseStatus);

  return (
    <div
      class="month-event-chip flex items-center gap-1 px-1 py-0.5 rounded-md text-xs truncate cursor-pointer hover:brightness-95 transition-[filter]"
      classList={{
        "month-event-chip--needs-action": selfResponse() === "needsAction",
        "month-event-chip--tentative": selfResponse() === "tentative",
      }}
      style={{ "--event-color": props.event.color }}
      tabIndex={0}
      role="button"
      aria-label={`${props.event.title} at ${time()}${props.event.recurringEventId || props.event.recurrence ? ", recurring" : ""}`}
    >
      <span class="shrink-0 opacity-60">{time()}</span>
      <span class="truncate">{props.event.title}</span>
      <Show when={props.event.recurringEventId || props.event.recurrence}>
        <Repeat size={10} class="shrink-0 opacity-60" aria-hidden="true" />
      </Show>
    </div>
  );
}
