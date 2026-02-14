import { Show, For, createMemo, onCleanup } from "solid-js";
import { Clock, MapPin, AlignLeft, Users } from "lucide-solid";
import type { Attendee } from "@cathrin/shared-types";
import type { CalendarEvent } from "../../stores/event-types";
import { setEvents, events } from "../../stores/events";
import { apiFetch } from "../../lib/api";
import { connectedAccounts } from "../../stores/accounts";
import { formatTime, formatDate } from "../../lib/format-utils";
import { sortAttendees, ResponseStatusIcon, STATUS_LABELS } from "./attendee-utils";

interface EventDetailPanelProps {
  event: CalendarEvent;
}

export function EventDetailPanel(props: EventDetailPanelProps) {
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

        {/* Attendees */}
        <Show when={props.event.attendees?.length}>
          {(_) => {
            const selfAttendee = () => props.event.attendees!.find(a => a.isSelf);
            const canRsvp = () => {
              const self = selfAttendee();
              return self && !self.isOrganizer;
            };
            return (
              <div class="px-3 py-2 border-t border-border">
                <div class="flex items-center gap-2 text-sm text-fg-muted mb-1.5">
                  <Users size={14} class="shrink-0" />
                  <span>Participants ({props.event.attendees!.length})</span>
                </div>
                <div class="max-h-52 overflow-y-auto">
                  <For each={sortAttendees(props.event.attendees!)}>
                    {(attendee) => (
                      <div
                        class="flex items-center gap-2 pl-[22px] py-1.5"
                        role="listitem"
                        aria-label={`${attendee.name || attendee.email}, ${STATUS_LABELS[attendee.responseStatus] ?? "No response"}${attendee.isOrganizer ? ", Organizer" : ""}${attendee.isSelf ? ", You" : ""}`}
                      >
                        <ResponseStatusIcon status={attendee.responseStatus} />
                        <span class="flex-1 text-sm truncate">
                          {attendee.name || attendee.email}
                        </span>
                        <Show when={attendee.isSelf || attendee.isOrganizer}>
                          <span class="text-2xs text-fg-disabled shrink-0">
                            {attendee.isSelf && attendee.isOrganizer
                              ? "You · Organizer"
                              : attendee.isSelf ? "You" : "Organizer"}
                          </span>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
                <Show when={canRsvp()}>
                  <DetailRsvpButtons eventId={props.event.id} currentStatus={selfAttendee()!.responseStatus} />
                </Show>
              </div>
            );
          }}
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

function DetailRsvpButtons(props: { eventId: string; currentStatus: Attendee["responseStatus"] }) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let originalAttendees: Attendee[] | null = null;

  onCleanup(() => { if (timer) { clearTimeout(timer); timer = null; } });

  function handleRsvp(status: "accepted" | "declined" | "tentative"): void {
    const event = events().find((e) => e.id === props.eventId);
    if (!event?.attendees) return;

    if (!originalAttendees) originalAttendees = event.attendees;

    const updated = event.attendees.map(a => a.isSelf ? { ...a, responseStatus: status } : a);
    setEvents((prev) =>
      prev.map((e) => e.id === props.eventId ? { ...e, attendees: updated } : e)
    );

    if (timer) clearTimeout(timer);
    const eventId = props.eventId;
    const providerEventId = event.providerEventId;
    const rollback = originalAttendees;
    timer = setTimeout(() => {
      timer = null;
      originalAttendees = null;
      apiFetch(`/api/events/${encodeURIComponent(providerEventId)}/rsvp?calendarId=${encodeURIComponent(event.calendarId)}`, {
        method: "PATCH",
        body: JSON.stringify({ responseStatus: status, sendUpdates: "none" }),
      }).catch((err) => {
        console.error("[rsvp] Failed:", err);
        setEvents((prev) =>
          prev.map((e) => e.id === eventId ? { ...e, attendees: rollback } : e)
        );
      });
    }, 300);
  }

  const buttonClass = (status: string) => {
    const isActive = props.currentStatus === status;
    return `flex-1 text-xs py-1.5 rounded transition-colors cursor-pointer border-none outline-none ${
      isActive
        ? "bg-fg text-surface font-medium"
        : "bg-surface-hover text-fg-muted hover:text-fg"
    }`;
  };

  return (
    <div
      class="flex gap-1 pl-[22px] pr-2 pt-2"
      role="group"
      aria-label="Your response"
    >
      <button
        class={buttonClass("accepted")}
        aria-pressed={props.currentStatus === "accepted"}
        onClick={() => handleRsvp("accepted")}
      >
        Accept
      </button>
      <button
        class={buttonClass("tentative")}
        aria-pressed={props.currentStatus === "tentative"}
        onClick={() => handleRsvp("tentative")}
      >
        Maybe
      </button>
      <button
        class={buttonClass("declined")}
        aria-pressed={props.currentStatus === "declined"}
        onClick={() => handleRsvp("declined")}
      >
        Decline
      </button>
    </div>
  );
}
