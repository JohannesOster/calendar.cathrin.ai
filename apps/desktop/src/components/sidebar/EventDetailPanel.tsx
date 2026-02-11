import { Show, createMemo } from "solid-js";
import { Clock, MapPin, AlignLeft } from "lucide-solid";
import type { CalendarEvent } from "../../stores/event-types";
import { connectedAccounts } from "../../stores/accounts";
import { formatTime, formatDate, formatTimeRange } from "../../lib/format-utils";

interface EventDetailPanelProps {
  event: CalendarEvent;
}

export function EventDetailPanel(props: EventDetailPanelProps) {
  const contextLine = createMemo(() => {
    switch (props.event.readOnlyReason) {
      case "calendar_read_only":
        return `From ${calendarName()} · View only`;
      case "not_organizer":
        return `From ${calendarName()}`;
      case "locked":
        return "This event is locked";
      default:
        return "View only";
    }
  });

  function calendarName(): string {
    for (const account of connectedAccounts()) {
      const cal = account.calendars.find((c) => c.id === props.event.calendarId);
      if (cal) return cal.name;
    }
    return "calendar";
  }

  function accountEmail(): string {
    for (const account of connectedAccounts()) {
      if (account.calendars.some((c) => c.id === props.event.calendarId)) {
        return account.email;
      }
    }
    return "";
  }

  const dateDisplay = createMemo(() => {
    const start = props.event.start;
    const end = props.event.end;
    const sameDay =
      start.getDate() === end.getDate() &&
      start.getMonth() === end.getMonth() &&
      start.getFullYear() === end.getFullYear();

    if (props.event.isAllDay) {
      if (sameDay) return formatDate(start);
      return `${formatDate(start)} – ${formatDate(end)}`;
    }

    if (sameDay) {
      return `${formatDate(start)} · ${formatTime(start)} – ${formatTime(end)}`;
    }
    return `${formatDate(start)}, ${formatTime(start)} – ${formatDate(end)}, ${formatTime(end)}`;
  });

  return (
    <div class="h-full flex flex-col overflow-hidden" role="region" aria-label="Event details">
      <div class="flex-1 overflow-y-auto scrollbar-hidden">
        {/* Title */}
        <div class="px-3 pt-3 pb-1">
          <h2 class="text-sm font-medium text-fg break-words">{props.event.title}</h2>
          <p class="text-xs text-fg-muted mt-1">{contextLine()}</p>
        </div>

        {/* Date & time */}
        <div class="px-3 py-2 border-t border-border">
          <div class="flex items-center gap-2 text-sm text-fg">
            <Clock size={14} class="text-fg-muted shrink-0" />
            <span>{dateDisplay()}</span>
          </div>
        </div>

        {/* Location */}
        <Show when={props.event.location}>
          <div class="px-3 py-2 border-t border-border">
            <div class="flex items-center gap-2 text-sm text-fg">
              <MapPin size={14} class="text-fg-muted shrink-0" />
              <span class="break-words">{props.event.location}</span>
            </div>
          </div>
        </Show>

        {/* Description */}
        <Show when={props.event.description}>
          <div class="px-3 py-2 border-t border-border">
            <div class="flex items-start gap-2 text-sm text-fg">
              <AlignLeft size={14} class="text-fg-muted shrink-0 mt-0.5" />
              <p class="break-words whitespace-pre-wrap">{props.event.description}</p>
            </div>
          </div>
        </Show>

        {/* Calendar info */}
        <div class="px-3 py-2 border-t border-border">
          <div class="flex items-center gap-2">
            <div
              class="w-3 h-3 rounded-full shrink-0"
              style={{ "background-color": props.event.color }}
            />
            <div class="text-sm text-fg">
              <span>{calendarName()}</span>
              <Show when={accountEmail()}>
                <span class="text-fg-muted"> ({accountEmail()})</span>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
