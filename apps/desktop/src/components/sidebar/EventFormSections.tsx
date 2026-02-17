import { Show, For, createSignal, createMemo, createEffect, onCleanup, on } from "solid-js";
import type { Attendee } from "@cathrin/shared-types";
import {
  Clock,
  ArrowRight,
  Users,
  Video,
  MapPin,
  Bell,
  ChevronDown,
  EllipsisVertical,
  Globe,
  Lock,
  Copy,
  Calendar,
  LoaderCircle,
  Eye,
  EyeOff,
  CircleDot,
  Circle,
  Sun,
  Repeat,
  Info,
} from "lucide-solid";
import { sortAttendees, ResponseStatusIcon, STATUS_LABELS } from "./attendee-utils";
import { Switch } from "@ark-ui/solid/switch";
import { Select, createListCollection } from "@ark-ui/solid/select";
import { Combobox } from "@ark-ui/solid/combobox";
import { Popover } from "@ark-ui/solid/popover";
import { Tooltip } from "@ark-ui/solid/tooltip";
import { X } from "lucide-solid";
import { invoke } from "@tauri-apps/api/core";
import { apiFetch } from "../../lib/api";
import { CATHRIN_PALETTE } from "../../lib/color-mapping";
import type { CathrinColorKey } from "../../lib/color-mapping";
import { setDraftStart, setDraftEnd, commitCreation, draftTitle, setDraftAttendees } from "../../stores/event-creation";
import { formatTime, formatDuration, formatDate, parseTimeInput } from "../../lib/format-utils";
import { getAllDayInclusiveEnd } from "../../utils/allDayLayout";
import { isPendingNotification, removePendingNotification } from "../../stores/pending-notifications";
import { isBuffered, getOriginalAttendees, clearBuffer } from "../../stores/buffered-attendees";
import { selectedEventId, selectedEvent } from "../../stores/event-selection";
import { events, setEvents } from "../../stores/events";
import { CustomRecurrenceDialog } from "./CustomRecurrenceDialog";
import { dayCodeFromDate, ordinal, buildRrule } from "../../utils/recurrence-format";
import { NotificationConfirmPopover } from "../ui/NotificationConfirmPopover";
import type { ApiCalendarEvent } from "@cathrin/shared-types";
import type { EventFormState } from "./useEventFormState";
import { formatRecurrence } from "../../utils/recurrence-format";

interface SectionProps {
  state: EventFormState;
}

export function TimeSection(props: SectionProps) {
  const s = props.state;

  return (
    <div class="px-3 py-3 border-t border-border space-y-1.5">
      {/* Start time + End time on one row (hidden for all-day) */}
      <Show when={s.start() && s.end() && !s.isAllDay()}>
        <Show
          when={s.mode() === "create" || s.isOrganizer()}
          fallback={
            <div class="flex items-center gap-2 text-sm text-fg px-2 py-1.5">
              <Clock size={14} class="text-fg-muted shrink-0" />
              <span>{formatTime(s.start()!, s.timeZone())}</span>
              <ArrowRight size={14} class="text-fg-muted shrink-0" />
              <span>{formatTime(s.end()!, s.timeZone())}</span>
              <Show when={formatDate(s.start()!, s.timeZone()) === formatDate(s.end()!, s.timeZone())}>
                <span class="text-xs text-fg-muted whitespace-nowrap">
                  {formatDuration(s.start()!, s.end()!)}
                </span>
              </Show>
            </div>
          }
        >
          <div class="flex items-center gap-2 text-sm text-fg">
            <Clock size={14} class="text-fg-muted shrink-0" />
            <TimeCombobox
              date={() => s.start()!}
              timeZone={() => s.timeZone()}
              which="start"
              ariaLabel="Start time"
              state={s}
              referenceHour={() => new Date().getHours()}
            />
            <ArrowRight size={14} class="text-fg-muted shrink-0" />
            <TimeCombobox
              date={() => s.end()!}
              timeZone={() => s.timeZone()}
              which="end"
              ariaLabel="End time"
              state={s}
              referenceHour={() => s.start()!.getHours()}
              excludeBeforeMinutes={() => s.start()!.getHours() * 60 + s.start()!.getMinutes()}
            />
            <Show when={formatDate(s.start()!, s.timeZone()) === formatDate(s.end()!, s.timeZone())}>
              <span class="text-xs text-fg-muted whitespace-nowrap">
                {formatDuration(s.start()!, s.end()!)}
              </span>
            </Show>
          </div>
        </Show>
      </Show>
      {/* "Your time" row — shown when event timezone differs from system */}
      <Show when={s.start() && s.end() && !s.isAllDay() && s.timeZone() && s.timeZone() !== SYSTEM_TIMEZONE}>
        <div class="flex items-center gap-2 ml-[22px] text-xs text-fg-disabled">
          <span class="w-[4.5rem] whitespace-nowrap px-0.5">{formatTime(s.start()!)}</span>
          <ArrowRight size={14} class="shrink-0" />
          <span class="w-[4.5rem] whitespace-nowrap px-0.5">
            {formatTime(s.end()!)}
            {(() => {
              const offset = getLocalDayOffset(s.start()!, s.timeZone()!);
              if (offset === 0) return null;
              return <sup class="text-2xs ml-0.5">{offset > 0 ? `+${offset}` : offset}</sup>;
            })()}
          </span>
          <span class="whitespace-nowrap">your time</span>
        </div>
      </Show>
      {/* Date row */}
      <Show when={s.start() && s.end()}>
        <div
          class={`flex gap-4 text-sm text-fg ${s.isAllDay() ? "ml-0" : "ml-[22px]"}`}
        >
          <Show when={s.isAllDay()}>
            <Clock size={14} class="text-fg-muted shrink-0 mt-0.5" />
          </Show>
          <span>{formatDate(s.start()!, s.timeZone())}</span>
          {(() => {
            const displayEnd = s.isAllDay() ? getAllDayInclusiveEnd(s.end()!) : s.end()!;
            return (
              <Show when={formatDate(s.start()!, s.timeZone()) !== formatDate(displayEnd, s.timeZone())}>
                <span>{formatDate(displayEnd, s.timeZone())}</span>
              </Show>
            );
          })()}
        </div>
      </Show>
      {/* All-day toggle, timezone, repeat — organizer only */}
      <Show when={s.mode() === "create" || s.isOrganizer()}>
      <Switch.Root
        checked={s.isAllDay()}
        onCheckedChange={() => {
          const wasAllDay = s.isAllDay();
          const st = s.start()!;
          const editing = s.mode() === "edit";

          if (!wasAllDay) {
            // Timed -> all-day: save current times, set UTC midnight dates
            s.savedTimedStart = new Date(st);
            s.savedTimedEnd = s.end() ? new Date(s.end()!) : null;

            // All-day events use UTC midnight dates (matching Google's format)
            const allDayStart = new Date(
              Date.UTC(st.getFullYear(), st.getMonth(), st.getDate()),
            );
            const e = s.end() ?? st;
            const allDayEnd = new Date(
              Date.UTC(e.getFullYear(), e.getMonth(), e.getDate() + 1),
            );

            s.setIsAllDay(true);
            if (editing) {
              s.setEditStart(allDayStart);
              s.setEditEnd(allDayEnd);
              s.scheduleSave({
                isAllDay: true,
                start: allDayStart,
                end: allDayEnd,
              });
              s.flushSave();
            }
          } else {
            // All-day -> timed: restore saved times or use sensible defaults
            // All-day end dates are exclusive (Mon-Wed = end is Thu 00:00 UTC),
            // so subtract one day to get the actual last day.
            const rawEnd = s.end() ?? st;
            const lastDay = new Date(rawEnd);
            lastDay.setDate(lastDay.getDate() - 1);
            // If lastDay landed before start (single-day all-day), clamp to start
            if (lastDay < st) lastDay.setTime(st.getTime());

            const isMultiDay = lastDay.toDateString() !== st.toDateString();

            let newStart: Date;
            let newEnd: Date;
            if (s.savedTimedStart && s.savedTimedEnd) {
              newStart = new Date(st);
              newStart.setHours(
                s.savedTimedStart.getHours(),
                s.savedTimedStart.getMinutes(),
                0,
                0,
              );
              newEnd = new Date(isMultiDay ? lastDay : st);
              newEnd.setHours(
                s.savedTimedEnd.getHours(),
                s.savedTimedEnd.getMinutes(),
                0,
                0,
              );
            } else if (isMultiDay) {
              // Multi-day: default to 9am on first day, 5pm on last day
              newStart = new Date(st);
              newStart.setHours(9, 0, 0, 0);
              newEnd = new Date(lastDay);
              newEnd.setHours(17, 0, 0, 0);
            } else {
              // Single-day: default to 12pm + 1h
              newStart = new Date(st);
              newStart.setHours(12, 0, 0, 0);
              newEnd = new Date(st);
              newEnd.setHours(13, 0, 0, 0);
            }

            s.setIsAllDay(false);
            if (editing) {
              s.setEditStart(newStart);
              s.setEditEnd(newEnd);
              s.scheduleSave({
                isAllDay: false,
                start: newStart,
                end: newEnd,
              });
              s.flushSave();
            } else {
              setDraftStart(newStart);
              setDraftEnd(newEnd);
            }
          }
        }}
        class="flex items-center gap-2 cursor-pointer rounded px-2 py-2 hover:bg-surface-hover transition-colors"
      >
        <Sun size={14} class="text-fg-muted shrink-0" />
        <Switch.Label class="flex-1 text-sm text-fg-muted cursor-pointer">
          All-day
        </Switch.Label>
        <Switch.Control
          class={`relative w-7 h-4 rounded-full transition-colors duration-200 ${
            s.isAllDay() ? "bg-fg" : "bg-border-light"
          }`}
        >
          <Switch.Thumb
            class={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform duration-200 ${
              s.isAllDay() ? "translate-x-3" : "translate-x-0"
            }`}
          />
        </Switch.Control>
        <Switch.HiddenInput />
      </Switch.Root>
      {/* Timezone */}
      <Show when={!s.isAllDay()}>
        <TimezoneSelector state={s} />
      </Show>
      {/* Repeat */}
      <RecurrenceSelector state={s} />
      </Show>
    </div>
  );
}

export function DetailsSection(props: SectionProps) {
  const s = props.state;

  return (
    <div class="px-3 py-3 border-t border-border space-y-2">
      <AttendeeList
        attendees={s.attendees()}
        isOrganizer={s.isOrganizer()}
        accountEmail={s.accountEmail()}
        mode={s.mode()}
        onAdd={(email, name) => s.addAttendee(email, name)}
        onRemove={(email) => s.removeAttendee(email)}
        onRsvp={(status, sendUpdates) => s.rsvpAttendee(status, sendUpdates)}
      />
      <Show when={s.mode() === "create" || s.isOrganizer()}>
        <ConferencingField state={s} />
      </Show>
      <Show when={s.mode() !== "create" && !s.isOrganizer() && s.conferencing()}>
        {(conf) => (
          <div class="flex items-center gap-2 text-sm px-2 py-2">
            <Video size={14} class="text-fg-muted shrink-0" />
            <span class="flex-1 text-fg truncate">{conferencingLabel(conf())} Link</span>
          </div>
        )}
      </Show>
      <div class="flex items-center gap-2 text-sm rounded px-2 py-2 hover:bg-surface-hover focus-within:bg-surface-hover transition-colors">
        <MapPin size={14} class="text-fg-muted shrink-0" />
        <input
          type="text"
          placeholder="Add location"
          aria-label="Location"
          value={s.location()}
          onInput={(e) => s.setLocation(e.currentTarget.value)}
          onBlur={() => {
            if (s.mode() === "edit") s.flushSave();
          }}
          disabled={s.mode() === "edit" && !s.isOrganizer()}
          class={`flex-1 text-sm text-fg placeholder-fg-disabled bg-transparent outline-none border-none ${
            s.mode() === "edit" && !s.isOrganizer() ? "cursor-default" : ""
          }`}
        />
      </div>
      <Show
        when={s.mode() === "create" || s.canMoveCalendar()}
        fallback={
          <div class="flex items-center gap-x-8 px-2 py-2">
            <Calendar size={14} class="text-fg-muted shrink-0" />
            <span class="flex-1 text-sm text-fg">
              {(() => {
                const id = s.calendarId();
                if (!id) return "No calendar";
                const cal = s.allCalendars().find((c) => c.id === id);
                return cal?.name ?? "Unknown calendar";
              })()}
            </span>
            <div class="w-px h-4 bg-border shrink-0" />
            <ColorSelect state={s} />
          </div>
        }
      >
        <Select.Root
          collection={s.calendarCollection()}
          value={s.calendarId() ? [s.calendarId()!] : []}
          onValueChange={(details) => {
            s.setCalId(details.value[0] ?? null);
          }}
          positioning={{ placement: "bottom-start", sameWidth: true }}
          class="w-full"
        >
          <Select.Control>
            <div class="flex w-full items-center gap-2">
              <Select.Trigger class="flex flex-1 items-center gap-2 text-sm text-fg bg-transparent outline-none border-none cursor-pointer rounded px-2 py-2 hover:bg-surface-hover transition-colors">
                <Calendar size={14} class="text-fg-muted shrink-0" />
                <span class="flex-1 text-left">
                  {(() => {
                    const id = s.calendarId();
                    if (!id) return "Select calendar";
                    const cal = s.allCalendars().find((c) => c.id === id);
                    return cal?.name ?? "Select calendar";
                  })()}
                </span>
                <ChevronDown size={14} class="text-fg-muted shrink-0" />
              </Select.Trigger>
              <div class="w-px h-4 bg-border shrink-0" />
              <ColorSelect state={s} />
            </div>
          </Select.Control>
          <Select.Positioner>
            <Select.Content class="bg-surface border border-border rounded py-1 z-50 max-h-48 overflow-y-auto">
              <For each={s.allCalendars()}>
                {(cal) => (
                  <Select.Item
                    item={cal}
                    class="flex items-center gap-2 px-3 py-1.5 text-xs text-fg cursor-pointer hover:bg-surface-hover data-[highlighted]:bg-surface-hover outline-none"
                  >
                    <div
                      class="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ "background-color": cal.color }}
                    />
                    <Select.ItemText>{cal.name}</Select.ItemText>
                  </Select.Item>
                )}
              </For>
            </Select.Content>
          </Select.Positioner>
          <Select.HiddenSelect />
        </Select.Root>
      </Show>
    </div>
  );
}

export function DescriptionSection(props: SectionProps) {
  const s = props.state;

  return (
    <div class="px-3 py-3 border-t border-border">
      <textarea
        placeholder="Add description"
        aria-label="Description"
        value={s.description()}
        onInput={(e) => {
          s.setDescription(e.currentTarget.value);
          e.currentTarget.style.height = "auto";
          e.currentTarget.style.height =
            Math.min(e.currentTarget.scrollHeight, 160) + "px";
        }}
        onBlur={() => {
          if (s.mode() === "edit") s.flushSave();
        }}
        disabled={s.mode() === "edit" && !s.isOrganizer()}
        class={`w-full text-sm text-fg placeholder-fg-disabled appearance-none outline-none border-none resize-none overflow-hidden rounded px-2 py-1 transition-colors ${
          s.mode() === "edit" && !s.isOrganizer()
            ? "bg-transparent cursor-default"
            : "bg-surface-input hover:bg-surface-hover focus:bg-surface-hover"
        }`}
        rows={2}
      />
    </div>
  );
}

export function CalendarSection(props: SectionProps) {
  const s = props.state;

  return (
    <div class="px-3 py-3 border-t border-border">
      <div class="flex items-center gap-2">
        <div class="w-2/5 shrink-0">
          <Select.Root
            collection={s.transparencyCollection()}
            value={[s.transparency()]}
            onValueChange={(details) => {
              const val = details.value[0];
              if (val === "opaque" || val === "transparent") {
                s.setTransparency(val);
              }
            }}
            positioning={{ placement: "bottom-start" }}
          >
            <Select.Control>
              <Select.Trigger
                aria-label="Free/Busy status"
                class="flex w-full items-center gap-2 text-xs bg-transparent outline-none border-none cursor-pointer rounded px-2 py-2 hover:bg-surface-hover transition-colors text-fg-muted hover:text-fg"
              >
                <Show
                  when={s.transparency() === "opaque"}
                  fallback={<Circle size={14} class="shrink-0" />}
                >
                  <CircleDot size={14} class="shrink-0" />
                </Show>
                <span class="flex-1 text-left">{s.transparency() === "opaque" ? "Busy" : "Free"}</span>
                <ChevronDown size={14} class="text-fg-muted shrink-0" />
              </Select.Trigger>
            </Select.Control>
            <Select.Positioner>
              <Select.Content class="bg-surface border border-border rounded py-1 z-50">
                <For each={s.transparencyCollection().items}>
                  {(item) => (
                    <Select.Item
                      item={item}
                      class="flex items-center gap-2 px-3 py-1.5 text-xs text-fg cursor-pointer hover:bg-surface-hover data-[highlighted]:bg-surface-hover outline-none"
                    >
                      <Select.ItemText>{item.label}</Select.ItemText>
                    </Select.Item>
                  )}
                </For>
              </Select.Content>
            </Select.Positioner>
            <Select.HiddenSelect />
          </Select.Root>
        </div>
        <div class="w-px h-4 bg-border shrink-0" />
        <div class="w-3/5">
          <Select.Root
            collection={s.visibilityCollection()}
            value={[s.visibility()]}
            onValueChange={(details) => {
              const val = details.value[0];
              if (val === "default" || val === "public" || val === "private") {
                s.setVisibility(val);
              }
            }}
            disabled={s.mode() === "edit" && !s.isOrganizer()}
            positioning={{ placement: "bottom-start" }}
          >
            <Select.Control>
              <Select.Trigger
                aria-label="Event visibility"
                class="flex w-full items-center gap-2 text-xs bg-transparent outline-none border-none cursor-pointer rounded px-2 py-2 hover:bg-surface-hover transition-colors text-fg-muted hover:text-fg"
              >
                <Show
                  when={s.visibility() === "private"}
                  fallback={<Eye size={14} class="shrink-0" />}
                >
                  <EyeOff size={14} class="shrink-0" />
                </Show>
                <span class="flex-1 text-left">
                  {s.visibility() === "default"
                    ? "Default"
                    : s.visibility() === "public"
                      ? "Public"
                      : "Private"}
                </span>
                <ChevronDown size={14} class="text-fg-muted shrink-0" />
              </Select.Trigger>
            </Select.Control>
          <Select.Positioner>
            <Select.Content class="bg-surface border border-border rounded z-50">
              {/* Default — separated like color selector's "Calendar default" */}
              <Select.Item
                item={s.visibilityCollection().items[0]}
                class="flex items-center gap-2 px-3 py-1.5 text-xs text-fg cursor-pointer hover:bg-surface-hover data-[highlighted]:bg-surface-hover outline-none"
              >
                <Select.ItemText>Default</Select.ItemText>
              </Select.Item>
              <div class="border-t border-border" />
              <For each={s.visibilityCollection().items.slice(1)}>
                {(item) => (
                  <Select.Item
                    item={item}
                    class="flex items-center gap-2 px-3 py-1.5 text-xs text-fg cursor-pointer hover:bg-surface-hover data-[highlighted]:bg-surface-hover outline-none"
                  >
                    <Select.ItemText>{item.label}</Select.ItemText>
                  </Select.Item>
                )}
              </For>
            </Select.Content>
          </Select.Positioner>
          <Select.HiddenSelect />
        </Select.Root>
        </div>
      </div>
    </div>
  );
}

const MAX_REMINDER_MINUTES = 40320; // 4 weeks — Google Calendar API limit

const REMINDER_PRESETS = [
  { minutes: 5, label: "5 min" },
  { minutes: 10, label: "10 min" },
  { minutes: 15, label: "15 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 1440, label: "1 day" },
];

function formatReminderValue(minutes: number): string {
  if (minutes >= 10080 && minutes % 10080 === 0) return `${minutes / 10080} wk`;
  if (minutes >= 1440) {
    const d = Math.floor(minutes / 1440);
    const remainder = minutes % 1440;
    if (remainder === 0) return `${d} day`;
    return `${d} day ${formatReminderValue(remainder)}`;
  }
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (m === 0) return `${h}hr`;
    return `${h}hr ${m}min`;
  }
  return `${minutes}min`;
}

/** Detect a unit hint from an alpha-only string. */
function detectUnit(alpha: string): string | null {
  // Multi-char patterns first (more specific, avoids false positives)
  if (/we|wk/.test(alpha)) return "w";
  if (/ho|hr/.test(alpha)) return "h";
  if (/da/.test(alpha)) return "d";
  if (/mi/.test(alpha)) return "m";
  // Single char only when it's the only letter (e.g. "2h", "5d")
  if (alpha.length === 1 && /[mhdw]/.test(alpha)) return alpha;
  return null;
}

const UNIT_TO_MINUTES: Record<string, number> = { m: 1, h: 60, d: 1440, w: 10080 };

/**
 * Extract a number and optional unit from fuzzy input.
 * Handles single ("30omin", "2h") and compound ("1h30m", "1h 30") expressions.
 */
function extractReminderParts(text: string): { num: number; unit: string | null; compound: boolean } | null {
  const groups = [...text.matchAll(/(\d+)\s*([a-z]*)/g)];
  if (groups.length === 0) return null;

  // Compound: "1h30m", "1h 30", "2d 12h" — requires at least one explicit unit
  if (groups.length >= 2 && groups.some(([, , u]) => detectUnit(u) !== null)) {
    let total = 0;
    for (const [, digits, unitText] of groups) {
      const n = parseInt(digits, 10);
      if (isNaN(n) || n <= 0) continue;
      const u = detectUnit(unitText) ?? "m";
      total += n * (UNIT_TO_MINUTES[u] ?? 1);
    }
    return total > 0 ? { num: total, unit: "m", compound: true } : null;
  }

  // Single expression: first contiguous digit run + fuzzy unit from all alpha chars
  const num = parseInt(groups[0][1], 10);
  if (num <= 0 || isNaN(num)) return null;
  const alpha = text.replace(/[^a-z]/g, "");
  return { num, unit: detectUnit(alpha), compound: false };
}

function parseReminderInput(input: string): number | null {
  const parts = extractReminderParts(input.trim().toLowerCase());
  if (!parts) return null;
  const { num, unit, compound } = parts;
  const minutes = compound ? num : num * (UNIT_TO_MINUTES[unit ?? "m"] ?? 1);
  return minutes > MAX_REMINDER_MINUTES ? null : minutes;
}

export function RemindersSection(props: SectionProps) {
  const s = props.state;

  return (
    <div class="px-3 py-3 border-t border-border space-y-1">
      <Show when={s.reminders().length < 5}>
        <ReminderCombobox state={s} />
      </Show>
      <Show when={s.reminders().length > 0}>
        <div class="flex flex-col">
          <For each={[...s.reminders()].sort((a, b) => a.minutes - b.minutes)}>
            {(r) => (
              <div
                class="group flex items-center gap-2 pl-[30px] pr-2 py-2 rounded hover:bg-surface-hover transition-colors"
                aria-label={`${formatReminderValue(r.minutes)} before, press delete to remove`}
              >
                <span class="flex-1 text-sm text-fg-muted">
                  {formatReminderValue(r.minutes)} before
                </span>
                <button
                  class="text-fg-muted/0 group-hover:text-fg-muted hover:!text-fg transition-colors cursor-pointer p-0.5"
                  onClick={() => s.removeReminder(r.minutes)}
                  aria-label={`Remove ${formatReminderValue(r.minutes)} before reminder`}
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

// =============================================================================
// Attendee list
// =============================================================================

function AttendeeList(props: {
  attendees: Attendee[] | undefined;
  isOrganizer: boolean;
  accountEmail: string | null;
  mode: "create" | "edit";
  onAdd: (email: string, name?: string) => void;
  onRemove: (email: string) => void;
  onRsvp: (status: "accepted" | "declined" | "tentative", sendUpdates: "all" | "none") => void;
}) {
  const hasAttendees = () => !!props.attendees && props.attendees.length > 0;
  const sorted = createMemo(() => hasAttendees() ? sortAttendees(props.attendees!) : []);
  const selfAttendee = createMemo(() => props.attendees?.find(a => a.isSelf));
  const canRsvp = createMemo(() => {
    if (props.isOrganizer) return false;
    const self = selfAttendee();
    return self && !self.isOrganizer;
  });

  const organizerName = createMemo(() => {
    const organizer = props.attendees?.find(a => a.isOrganizer && !a.isSelf);
    if (!organizer) return "";
    return organizer.name || organizer.email;
  });

  const hasPendingNotification = createMemo(() => {
    const eventId = selectedEventId();
    return eventId ? isPendingNotification(eventId) : false;
  });

  const hasBufferedChanges = createMemo(() => {
    const eventId = selectedEventId();
    return eventId ? isBuffered(eventId) : false;
  });

  const [pendingRemovals, setPendingRemovals] = createSignal<Set<string>>(new Set());
  const [isExpanded, setIsExpanded] = createSignal(false);

  // Reset transient state when switching events
  createEffect(on(() => selectedEventId(), () => {
    setPendingRemovals(new Set());
    setIsExpanded(false);
  }));

  const collapseState = createMemo(() => {
    const all = sorted();
    if (isExpanded()) return { top: all, pinned: null as Attendee | null, hiddenCount: 0 };

    const self = selfAttendee();
    const first3 = all.slice(0, 3);
    const selfInFirst3 = self ? first3.some(a => a.email === self.email) : true;
    const pinned = (!selfInFirst3 && self) ? self : null;
    const visibleCount = first3.length + (pinned ? 1 : 0);
    const hidden = all.length - visibleCount;
    if (hidden < 2) return { top: all, pinned: null as Attendee | null, hiddenCount: 0 };
    return { top: first3, pinned, hiddenCount: hidden };
  });

  const isPendingRemoval = (email: string) => pendingRemovals().has(email.toLowerCase());

  function togglePendingRemoval(email: string): void {
    setPendingRemovals(prev => {
      const next = new Set(prev);
      const key = email.toLowerCase();
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const showNotificationPopover = createMemo(() => {
    if (props.mode === "create") {
      // Show when there are non-self attendees to notify
      return (props.attendees ?? []).some(a => !a.isSelf);
    }
    // Active work in progress — always show
    if (hasBufferedChanges() || pendingRemovals().size > 0) return true;
    // Pending notification only matters when there are non-self attendees to act on
    if (hasPendingNotification()) {
      return (props.attendees ?? []).some(a => !a.isSelf);
    }
    return false;
  });

  const addedCount = createMemo(() => {
    if (props.mode === "create") {
      // In create mode, all non-self attendees are "new"
      return (props.attendees ?? []).filter(a => !a.isSelf).length;
    }
    const eventId = selectedEventId();
    if (!eventId) return 0;
    const removals = pendingRemovals();
    const current = (props.attendees ?? []).filter(
      a => !a.isSelf && !removals.has(a.email.toLowerCase())
    );
    const original = getOriginalAttendees(eventId);
    if (!original) {
      // Only treat all attendees as new in the creation case
      return isPendingNotification(eventId) ? current.length : 0;
    }
    const originalEmails = new Set(original.map(a => a.email.toLowerCase()));
    return current.filter(a => !originalEmails.has(a.email.toLowerCase())).length;
  });

  const removedCount = createMemo(() => pendingRemovals().size);

  const isCreationPending = createMemo(() => {
    const eventId = selectedEventId();
    if (!eventId) return false;
    return isPendingNotification(eventId) && !isBuffered(eventId);
  });

  async function handleSendInvitations(): Promise<void> {
    const eventId = selectedEventId();
    if (!eventId) return;
    const hasRemovals = pendingRemovals().size > 0;
    // Apply pending removals first
    for (const email of pendingRemovals()) {
      props.onRemove(email);
    }
    setPendingRemovals(new Set());
    // Read attendees from form state (protected by buffer guard against poll overwrites)
    // instead of from events() store which polling can overwrite with stale server data.
    const attendees = props.attendees ?? [];
    const event = events().find(e => e.id === eventId);
    if (!event) return;
    const eventUrl = `/api/events/${encodeURIComponent(event.providerEventId)}?calendarId=${encodeURIComponent(event.calendarId)}`;

    if (isCreationPending() && hasRemovals) {
      // Creation-pending with removals: two-step PATCH to avoid Google
      // sending cancellation emails to never-invited attendees.
      // Step 1: Strip all non-self attendees silently
      const selfOnly = attendees.filter(a => a.isSelf);
      await apiFetch<ApiCalendarEvent>(eventUrl, {
        method: "PATCH",
        body: JSON.stringify({
          attendees: selfOnly.map(a => ({ email: a.email, name: a.name })),
          sendUpdates: "none",
        }),
      });
      // Step 2: Re-add remaining attendees with notifications.
      // If this fails, revert step 1 by restoring all attendees silently.
      const remaining = attendees.filter(a => !a.isSelf);
      if (remaining.length > 0) {
        const allAttendees = [...selfOnly, ...remaining];
        try {
          const response = await apiFetch<ApiCalendarEvent>(eventUrl, {
            method: "PATCH",
            body: JSON.stringify({
              attendees: allAttendees.map(a => ({ email: a.email, name: a.name })),
              sendUpdates: "all",
            }),
          });
          setEvents((prev) => prev.map((e) =>
            e.id === eventId ? { ...e, attendees: response.attendees } : e
          ));
        } catch (err) {
          console.error("[attendees] Step 2 failed, reverting step 1:", err);
          await apiFetch<ApiCalendarEvent>(eventUrl, {
            method: "PATCH",
            body: JSON.stringify({
              attendees: allAttendees.map(a => ({ email: a.email, name: a.name })),
              sendUpdates: "none",
            }),
          }).catch(revertErr => console.error("[attendees] Revert also failed:", revertErr));
          throw err;
        }
      }
    } else {
      // Normal case: PATCH with current attendees + sendUpdates: "all"
      const response = await apiFetch<ApiCalendarEvent>(eventUrl, {
        method: "PATCH",
        body: JSON.stringify({
          attendees: attendees.map(a => ({ email: a.email, name: a.name })),
          sendUpdates: "all",
        }),
      });
      // Update store with server-confirmed attendees so clearBuffer's
      // sync effect reads correct data instead of potentially stale poll data.
      setEvents((prev) => prev.map((e) =>
        e.id === eventId ? { ...e, attendees: response.attendees } : e
      ));
    }
    clearBuffer(eventId);
    removePendingNotification(eventId);
  }

  function handleSendSilent(): void {
    const eventId = selectedEventId();
    if (!eventId) return;
    const hasRemovals = pendingRemovals().size > 0;
    // Apply pending removals first
    for (const email of pendingRemovals()) {
      props.onRemove(email);
    }
    setPendingRemovals(new Set());

    if (isBuffered(eventId) || hasRemovals) {
      // Read attendees from form state (protected by buffer guard) not from store
      const attendees = props.attendees ?? [];
      const event = events().find(e => e.id === eventId);
      if (event) {
        // Re-assert current attendees in store before clearBuffer so the sync
        // effect reads correct data (store may have been overwritten by polling).
        setEvents((prev) => prev.map((e) =>
          e.id === eventId ? { ...e, attendees: attendees.length > 0 ? attendees : undefined } : e
        ));
        apiFetch(`/api/events/${encodeURIComponent(event.providerEventId)}?calendarId=${encodeURIComponent(event.calendarId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            attendees: attendees.map(a => ({ email: a.email, name: a.name })),
            sendUpdates: "none",
          }),
        }).catch(err => console.error("[attendees] Failed to save silently:", err));
      }
      clearBuffer(eventId);
    }
    removePendingNotification(eventId);
  }

  // --- Create-mode handlers ---
  async function handleCreateSend(): Promise<void> {
    commitCreation("all");
  }

  function handleCreateSilent(): void {
    commitCreation("none");
  }

  async function handleCreateDiscard(): Promise<void> {
    setDraftAttendees([]);
  }

  async function handleDiscard(): Promise<void> {
    const eventId = selectedEventId();
    if (!eventId) return;
    const hadPendingRemovals = pendingRemovals().size > 0;
    // Clear pending removals
    setPendingRemovals(new Set());

    if (isBuffered(eventId)) {
      // Edit buffered case: revert to original attendees
      const original = getOriginalAttendees(eventId);
      setEvents((prev) => prev.map(e =>
        e.id === eventId
          ? { ...e, attendees: original && original.length > 0 ? original : undefined }
          : e
      ));
      clearBuffer(eventId);
      return;
    }

    // Creation-pending with only pending removals (no buffer): just undo the removals.
    // The pending notification survives so the popover reverts to "Send invite".
    if (hadPendingRemovals && isPendingNotification(eventId)) return;

    if (!isPendingNotification(eventId)) return;

    // Creation pending case: remove all attendees from server
    const event = events().find(e => e.id === eventId);
    if (!event) return;
    await apiFetch<ApiCalendarEvent>(
      `/api/events/${encodeURIComponent(event.providerEventId)}?calendarId=${encodeURIComponent(event.calendarId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ attendees: null, sendUpdates: "none" }),
      }
    );
    setEvents((prev) => prev.map(e => e.id === eventId ? { ...e, attendees: undefined } : e));
    removePendingNotification(eventId);
  }

  const rsvpSummary = createMemo(() => {
    if (!hasAttendees()) return "";
    const counts: Record<string, number> = { accepted: 0, maybe: 0, declined: 0, pending: 0 };
    for (const a of props.attendees!) {
      if (a.responseStatus === "accepted") counts.accepted++;
      else if (a.responseStatus === "tentative") counts.maybe++;
      else if (a.responseStatus === "declined") counts.declined++;
      else counts.pending++;
    }
    return Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([status, n]) => `${n} ${status}`)
      .join(" \u00b7 ");
  });

  const renderAttendeeRow = (attendee: Attendee) => {
    const pending = () => isPendingRemoval(attendee.email);
    return (
      <div
        class={`group flex items-center gap-2 pl-[30px] pr-2 py-1.5 rounded transition-colors ${
          pending() ? "" : "hover:bg-surface-hover"
        }`}
        role="listitem"
        aria-label={`${attendee.name || attendee.email}, ${STATUS_LABELS[attendee.responseStatus] ?? "No response"}${attendee.isOrganizer ? ", Organizer" : ""}${attendee.isSelf ? ", you" : ""}${pending() ? ", pending removal" : ""}`}
      >
        <span class={pending() ? "opacity-40" : ""}>
          <ResponseStatusIcon status={attendee.responseStatus} />
        </span>
        <span
          class={`flex-1 text-sm truncate ${
            pending() ? "text-fg-disabled line-through" : "text-fg"
          }`}
        >
          {attendee.name || attendee.email}
        </span>
        <Show when={attendee.isSelf || attendee.isOrganizer}>
          <span class={`text-2xs shrink-0 ${pending() ? "text-fg-disabled/50" : "text-fg-disabled"}`}>
            {attendee.isSelf && attendee.isOrganizer
              ? "You · Organizer"
              : attendee.isSelf ? "You" : "Organizer"}
          </span>
        </Show>
        <Show when={props.isOrganizer && !attendee.isSelf}>
          <button
            class={`transition-colors cursor-pointer p-0.5 ${
              pending()
                ? "text-fg-muted hover:text-fg"
                : "text-fg-muted/0 group-hover:text-fg-muted hover:!text-fg"
            }`}
            onClick={() => {
              if (props.mode === "edit") {
                const eventId = selectedEventId();
                const original = eventId ? getOriginalAttendees(eventId) : undefined;
                if (original && !original.some(a => a.email.toLowerCase() === attendee.email.toLowerCase())) {
                  props.onRemove(attendee.email);
                } else {
                  togglePendingRemoval(attendee.email);
                }
              } else {
                props.onRemove(attendee.email);
              }
            }}
            aria-label={pending()
              ? `Undo remove ${attendee.name || attendee.email}`
              : `Remove ${attendee.name || attendee.email}`
            }
          >
            <X size={12} />
          </button>
        </Show>
      </div>
    );
  };

  return (
    <div class="space-y-0.5">
      <Show
        when={hasAttendees()}
        fallback={
          <Show when={props.isOrganizer}>
            <AttendeeCombobox
              attendees={props.attendees}
              accountEmail={props.accountEmail}
              onAdd={props.onAdd}
              inline
            />
          </Show>
        }
      >
        {/* Populated header */}
        <div class="px-2 py-2">
          <div
            class="flex items-center gap-2"
            aria-label={`${props.attendees!.length} participants: ${rsvpSummary()}`}
          >
            <Users size={14} class="text-fg-muted shrink-0" />
            <div class="flex flex-col">
              <span class="text-sm text-fg">
                {props.attendees!.length} participant{props.attendees!.length !== 1 ? "s" : ""}
              </span>
              <Show when={rsvpSummary()}>
                <span class="text-xs text-fg-muted">{rsvpSummary()}</span>
              </Show>
            </div>
          </div>
        </div>
        <For each={collapseState().top}>
          {(attendee) => renderAttendeeRow(attendee)}
        </For>
        <Show when={collapseState().hiddenCount > 0}>
          <button
            class="flex items-center gap-1.5 pl-[30px] pr-2 py-1.5 text-sm text-fg-muted hover:text-fg transition-colors cursor-pointer w-full bg-transparent border-none outline-none"
            onClick={() => setIsExpanded(true)}
          >
            <EllipsisVertical size={12} class="shrink-0" />
            <span>Show {collapseState().hiddenCount} more participants</span>
          </button>
        </Show>
        <Show when={collapseState().pinned}>
          {(self) => renderAttendeeRow(self())}
        </Show>
        <Show when={canRsvp()}>
          <RsvpButtons currentStatus={selfAttendee()!.responseStatus} organizerName={organizerName()} onRsvp={props.onRsvp} />
        </Show>
      </Show>
      <Show when={showNotificationPopover()}>
        <NotificationConfirmPopover
          addedCount={addedCount()}
          removedCount={props.mode === "create" ? 0 : removedCount()}
          isCreationPending={props.mode === "create" || isCreationPending()}
          commitDisabled={props.mode === "create" && !draftTitle().trim()}
          onSend={props.mode === "create" ? handleCreateSend : handleSendInvitations}
          onSendSilent={props.mode === "create" ? handleCreateSilent : handleSendSilent}
          onDiscard={props.mode === "create" ? handleCreateDiscard : handleDiscard}
        />
      </Show>
      <Show when={hasAttendees() && props.isOrganizer}>
        <AttendeeCombobox attendees={props.attendees} accountEmail={props.accountEmail} onAdd={props.onAdd} />
      </Show>
    </div>
  );
}

interface ContactSuggestion {
  email: string;
  name: string | null;
  score: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

function AttendeeCombobox(props: {
  attendees: Attendee[] | undefined;
  accountEmail: string | null;
  onAdd: (email: string, name?: string) => void;
  inline?: boolean;
}) {
  let inputRef: HTMLInputElement | undefined;
  const [inputValue, setInputValue] = createSignal("");
  const [query, setQuery] = createSignal("");
  const [suggestions, setSuggestions] = createSignal<ContactSuggestion[]>([]);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let zeroStateCache: ContactSuggestion[] | null = null;
  // Only mirror highlighted item into input on explicit navigation (hover/arrow),
  // not when autohighlight fires after typing.
  let userNavigated = false;

  onCleanup(() => clearTimeout(debounceTimer));

  const existingEmails = createMemo(() =>
    new Set((props.attendees ?? []).map(a => a.email.toLowerCase()))
  );

  const filtered = createMemo(() =>
    suggestions().filter(c => !existingEmails().has(c.email.toLowerCase()))
  );

  const items = createMemo(() =>
    filtered().map(c => ({ value: c.email, name: c.name }))
  );

  const collection = createMemo(() => {
    const q = query().toLowerCase();
    return createListCollection({
      items: items(),
      itemToValue: (item) => item.value,
      itemToString: (item) => q ? `${q} ${item.value}` : item.value,
    });
  });

  async function fetchSuggestions(q: string): Promise<void> {
    if (q === "" && zeroStateCache) {
      setSuggestions(zeroStateCache);
      return;
    }
    try {
      const result = await apiFetch<{ contacts: ContactSuggestion[] }>(
        `/api/contacts/suggestions?q=${encodeURIComponent(q)}&limit=8`
      );
      if (q === "") zeroStateCache = result.contacts;
      setSuggestions(result.contacts);
    } catch {
      // API error — fall back to raw email input behavior
    }
  }

  function debouncedFetch(q: string): void {
    clearTimeout(debounceTimer);
    if (q === "") {
      fetchSuggestions("").catch(() => {});
      return;
    }
    debounceTimer = setTimeout(() => {
      fetchSuggestions(q).catch(() => {});
    }, 200);
  }

  function handleAdd(email: string, name?: string): void {
    const trimmed = email.trim();
    if (!trimmed || !isValidEmail(trimmed)) return;
    props.onAdd(trimmed, name || undefined);
    setInputValue("");
    setQuery("");
    setSuggestions(zeroStateCache ?? []);
  }

  return (
    <Combobox.Root
      collection={collection()}
      value={[]}
      allowCustomValue
      openOnClick
      closeOnSelect
      inputBehavior="autohighlight"
      onHighlightChange={(d) => {
        if (d.highlightedValue != null && userNavigated) {
          const item = items().find((i) => i.value === d.highlightedValue);
          if (item) {
            setInputValue(item.name || item.value);
            requestAnimationFrame(() => inputRef?.select());
          }
        }
      }}
      inputValue={inputValue()}
      onInputValueChange={(d) => {
        userNavigated = false;
        setInputValue(d.inputValue);
        setQuery(d.inputValue);
        debouncedFetch(d.inputValue.trim());
      }}
      onValueChange={(details) => {
        const email = details.value[0];
        if (!email) return;
        const contact = filtered().find(c => c.email === email);
        handleAdd(email, contact?.name ?? undefined);
      }}
      onOpenChange={(d) => {
        if (d.open) {
          debouncedFetch("");
        } else {
          // Try to add any remaining email-like text (handles blur-to-add)
          const val = inputValue().trim();
          if (val && isValidEmail(val)) {
            handleAdd(val);
          }
          setInputValue("");
          setQuery("");
        }
      }}
      positioning={{ placement: "bottom-start", sameWidth: true }}
    >
      <Combobox.Control class={props.inline
        ? "flex items-center gap-2 text-sm rounded px-2 py-2 hover:bg-surface-hover focus-within:bg-surface-hover transition-colors"
        : "pl-[30px] pr-2"
      }>
        <Show when={props.inline}>
          <Users size={14} class="text-fg-muted shrink-0" />
        </Show>
        <Combobox.Input
          ref={(el) => { inputRef = el; }}
          placeholder={props.inline ? "Participants" : "Add participant"}
          aria-label="Add participants"
          autocomplete="off"
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              userNavigated = true;
            } else if (e.key === "Escape") {
              e.preventDefault();
              setInputValue("");
              setQuery("");
              (e.target as HTMLElement).blur();
            } else if (e.key === "Enter") {
              const val = inputValue().trim();
              if (val && isValidEmail(val)) {
                e.preventDefault();
                const contact = filtered().find(c => c.email.toLowerCase() === val.toLowerCase());
                handleAdd(val, contact?.name ?? undefined);
                return;
              }
              // Non-email text with suggestions visible — let Combobox handle
            }
          }}
          class={`flex-1 w-full text-sm text-fg placeholder-fg-disabled bg-transparent outline-none border-none ${props.inline ? "py-0" : "py-1.5"}`}
        />
      </Combobox.Control>
      <Combobox.Positioner>
        <Show when={items().length > 0}>
          <Combobox.Content
            class="bg-surface border border-border rounded py-1 z-50 max-h-48 overflow-y-auto"
            onPointerMove={() => { userNavigated = true; }}
          >
            <For each={items()}>
              {(item) => {
                const isSelf = () => props.accountEmail != null && item.value.toLowerCase() === props.accountEmail;
                return (
                  <Combobox.Item
                    item={item}
                    class="flex flex-col px-3 py-1.5 cursor-pointer hover:bg-surface-hover data-[highlighted]:bg-surface-hover outline-none"
                  >
                    <div class="flex items-center gap-1.5">
                      <Combobox.ItemText class="text-xs text-fg">
                        {item.name || item.value}
                      </Combobox.ItemText>
                      <Show when={isSelf()}>
                        <span class="text-2xs text-fg-disabled">(You)</span>
                      </Show>
                    </div>
                    <Show when={item.name}>
                      <span class="text-2xs text-fg-disabled">{item.value}</span>
                    </Show>
                  </Combobox.Item>
                );
              }}
            </For>
          </Combobox.Content>
        </Show>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}

const RSVP_LABELS: Record<string, { button: string; silent: string; notifyPrefix: string }> = {
  accepted: { button: "Accept", silent: "Accept without notifying", notifyPrefix: "Accept & notify" },
  tentative: { button: "Maybe", silent: "Respond tentatively without notifying", notifyPrefix: "Respond tentatively & notify" },
  declined: { button: "Decline", silent: "Decline without notifying", notifyPrefix: "Decline & notify" },
};

function RsvpButtons(props: {
  currentStatus: Attendee["responseStatus"];
  organizerName: string;
  onRsvp: (status: "accepted" | "declined" | "tentative", sendUpdates: "all" | "none") => void;
}) {
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
      class="flex gap-1 pl-[30px] pr-2 pt-1"
      role="group"
      aria-label="Your response"
    >
      <For each={["accepted", "tentative", "declined"] as const}>
        {(status) => (
          <Popover.Root positioning={{ placement: "top" }}>
            <Popover.Trigger
              class={buttonClass(status)}
              aria-pressed={props.currentStatus === status}
            >
              {RSVP_LABELS[status].button}
            </Popover.Trigger>
            <Popover.Positioner>
              <Popover.Content
                class="bg-surface border border-border rounded-lg shadow-lg z-50 w-64 py-2"
                aria-label="Choose how to respond to this invitation"
              >
                {/* Cancel */}
                <Popover.CloseTrigger
                  class="w-full text-left text-sm text-fg-muted hover:bg-surface-hover px-3 py-2 transition-colors cursor-pointer border-none outline-none bg-transparent"
                >
                  Cancel
                </Popover.CloseTrigger>

                {/* Notify organizer */}
                <Popover.CloseTrigger
                  class="w-full text-left text-sm text-fg hover:bg-surface-hover px-3 py-2 transition-colors cursor-pointer border-none outline-none bg-transparent"
                  onClick={() => props.onRsvp(status, "all")}
                >
                  {RSVP_LABELS[status].notifyPrefix} {props.organizerName}
                </Popover.CloseTrigger>

                {/* Primary: without notifying */}
                <div class="px-3 pt-1 pb-1">
                  <div class="flex items-center rounded-lg bg-accent hover:bg-accent/90 transition-colors">
                    <Popover.CloseTrigger
                      class="flex-1 text-sm py-2 px-3 text-white font-medium text-left cursor-pointer border-none outline-none bg-transparent"
                      onClick={() => props.onRsvp(status, "none")}
                    >
                      {RSVP_LABELS[status].silent}
                    </Popover.CloseTrigger>
                    <Tooltip.Root openDelay={200} positioning={{ placement: "top" }}>
                      <Tooltip.Trigger
                        class="text-white/50 hover:text-white/80 transition-colors cursor-help bg-transparent border-none outline-none p-1 pr-2.5"
                        aria-label="What does this mean?"
                      >
                        <Info size={14} />
                      </Tooltip.Trigger>
                      <Tooltip.Positioner>
                        <Tooltip.Content class="bg-fg text-surface text-xs rounded px-2 py-1 max-w-52 z-50">
                          {props.organizerName} will see your response on their next calendar sync. No email is sent.
                        </Tooltip.Content>
                      </Tooltip.Positioner>
                    </Tooltip.Root>
                  </div>
                </div>
              </Popover.Content>
            </Popover.Positioner>
          </Popover.Root>
        )}
      </For>
    </div>
  );
}

/** Extract a short display label from a conferencing URI */
function conferencingLabel(conf: { uri: string; label?: string }): string {
  if (conf.label) return conf.label;
  if (!conf.uri) return "Conferencing";
  try {
    const url = new URL(conf.uri);
    const host = url.hostname.replace(/^www\./, "");
    if (host.includes("meet.google.com")) return "Google Meet";
    if (host.includes("zoom.us")) return "Zoom";
    if (host.includes("teams.microsoft.com")) return "Microsoft Teams";
    return host;
  } catch {
    return conf.uri;
  }
}

function ConferencingField(props: { state: EventFormState }) {
  const s = props.state;
  const [showUrlInput, setShowUrlInput] = createSignal(false);
  const [urlValue, setUrlValue] = createSignal("");

  function handleAddClick(): void {
    // Auto-generate Meet link (all calendars are Google for now)
    s.addMeetConferencing();
  }

  function handleUrlSubmit(): void {
    const url = urlValue().trim();
    if (!url) {
      setShowUrlInput(false);
      return;
    }
    try {
      new URL(url); // Basic validation
      s.setManualConferencing(url);
      setShowUrlInput(false);
      setUrlValue("");
    } catch {
      // Invalid URL — keep input open
    }
  }

  function handleUrlKeyDown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      handleUrlSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setShowUrlInput(false);
      setUrlValue("");
    }
  }

  function openUrl(uri: string): void {
    if (!uri) return;
    invoke("open_url", { url: uri }).catch((err) =>
      console.error("[conferencing] Failed to open URL:", err),
    );
  }

  function copyUrl(uri: string): void {
    navigator.clipboard
      .writeText(uri)
      .catch((err) => console.error("[conferencing] Failed to copy URL:", err));
  }

  return (
    <>
      <Show when={s.conferencingLoading()}>
        <div class="flex items-center gap-2 text-sm text-fg-muted px-2 py-2">
          <LoaderCircle size={14} class="shrink-0 animate-spin" />
          <span>Adding Google Meet…</span>
        </div>
      </Show>
      <Show when={!s.conferencingLoading()}>
        <Show
          when={s.conferencing()}
          fallback={
            <Show
              when={showUrlInput()}
              fallback={
                <div class="flex items-center gap-1">
                  <button
                    class="flex flex-1 items-center gap-2 text-sm text-fg-muted cursor-pointer rounded px-2 py-2 hover:text-fg hover:bg-surface-hover transition-colors"
                    onClick={handleAddClick}
                    aria-label="Add Google Meet link"
                  >
                    <Video size={14} class="shrink-0" />
                    <span>Add conferencing</span>
                  </button>
                  <button
                    class="text-xs text-fg-disabled cursor-pointer rounded px-1 hover:text-fg-muted transition-colors"
                    onClick={() => setShowUrlInput(true)}
                    aria-label="Paste a conferencing URL"
                  >
                    URL
                  </button>
                </div>
              }
            >
              <div class="flex items-center gap-2 text-sm px-2">
                <Video size={14} class="text-fg-muted shrink-0" />
                <input
                  type="url"
                  placeholder="Paste conferencing URL"
                  aria-label="Conferencing URL"
                  value={urlValue()}
                  ref={(el) => requestAnimationFrame(() => el.focus())}
                  onInput={(e) => setUrlValue(e.currentTarget.value)}
                  onBlur={handleUrlSubmit}
                  onKeyDown={handleUrlKeyDown}
                  class="flex-1 text-sm text-fg py-2 px-2 placeholder-fg-disabled bg-surface-input outline-none border-none rounded hover:bg-surface-hover focus:bg-surface-hover transition-colors"
                />
                <button>
                  <X size={14} />
                </button>
              </div>
            </Show>
          }
        >
          {(conf) => (
            <div class="flex items-center gap-2 text-sm px-2 py-2">
              <Video size={14} class="text-fg-muted shrink-0" />
              <button
                class="flex-1 text-left text-fg truncate cursor-pointer hover:underline"
                onClick={() => openUrl(conf().uri)}
                disabled={!conf().uri}
                aria-label={`Open ${conferencingLabel(conf())} link`}
              >
                {conferencingLabel(conf())} Link
              </button>
              <Show when={conf().uri}>
                <button
                  class="text-fg-muted hover:text-fg transition-colors cursor-pointer shrink-0"
                  onClick={() => copyUrl(conf().uri)}
                  aria-label="Copy conferencing link"
                >
                  <Copy size={12} />
                </button>
              </Show>
              <button
                class="text-fg-muted hover:text-fg transition-colors cursor-pointer shrink-0"
                onClick={() => s.removeConferencing()}
                aria-label="Remove conferencing"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </Show>
      </Show>
    </>
  );
}

const COLOR_SWATCHES: { key: CathrinColorKey; label: string }[] = [
  { key: "graphite", label: "Graphite" },
  { key: "coral", label: "Coral" },
  { key: "terracotta", label: "Terracotta" },
  { key: "amber", label: "Amber" },
  { key: "sage", label: "Sage" },
  { key: "teal", label: "Teal" },
  { key: "sky", label: "Sky" },
  { key: "slate", label: "Slate" },
  { key: "lavender", label: "Lavender" },
  { key: "plum", label: "Plum" },
  { key: "rose", label: "Rose" },
];

function ColorSelect(props: { state: EventFormState }) {
  const s = props.state;

  const calendarColorKey = createMemo(() => {
    const hex = s.calendarColor();
    const entries = Object.entries(CATHRIN_PALETTE) as [
      CathrinColorKey,
      string,
    ][];
    const match = entries.find(([, v]) => v === hex);
    return match ? match[0] : null;
  });

  const otherSwatches = createMemo(() =>
    COLOR_SWATCHES.filter((sw) => sw.key !== calendarColorKey()),
  );

  const isSelected = (key: CathrinColorKey | null) => s.colorId() === key;

  const ringStyle = (color: string, selected: boolean) => ({
    "background-color": color,
    "box-shadow": selected
      ? `0 0 0 2px var(--color-surface), 0 0 0 3.5px ${color}`
      : undefined,
  });

  return (
    <Popover.Root positioning={{ placement: "bottom-start" }}>
      <Popover.Trigger class="flex items-center gap-1 rounded px-2 min-h-9 hover:bg-surface-hover transition-colors cursor-pointer bg-transparent border-none outline-none shrink-0">
        <div
          class="w-3.5 h-3.5 rounded-full shrink-0"
          style={{ "background-color": s.eventColor() }}
        />
        <ChevronDown size={12} class="text-fg-muted shrink-0" />
      </Popover.Trigger>
      <Popover.Positioner>
        <Popover.Content class="bg-surface border border-border rounded z-50 max-w-[180px]">
          {/* Header — calendar default */}
          <Popover.CloseTrigger
            class="flex items-center gap-2 w-full px-3 py-2 cursor-pointer bg-transparent border-none outline-none hover:bg-surface-hover transition-colors rounded-t"
            onClick={() => s.setColorId(null)}
          >
            <div
              class="w-3.5 h-3.5 rounded-full shrink-0"
              style={ringStyle(s.calendarColor(), isSelected(null))}
            />
            <span class="text-xs text-fg-muted">Calendar default</span>
          </Popover.CloseTrigger>
          {/* Body — palette swatches */}
          <div class="flex items-center gap-x-3 gap-y-3 flex-wrap px-3 pt-3 pb-4 border-t border-border">
            <For each={otherSwatches()}>
              {(swatch) => (
                <Popover.CloseTrigger
                  class="w-3.5 h-3.5 rounded-full cursor-pointer shrink-0 transition-transform hover:scale-125 bg-transparent border-none outline-none"
                  style={ringStyle(
                    CATHRIN_PALETTE[swatch.key],
                    isSelected(swatch.key),
                  )}
                  onClick={() => s.setColorId(swatch.key)}
                />
              )}
            </For>
          </div>
        </Popover.Content>
      </Popover.Positioner>
    </Popover.Root>
  );
}

function ReminderCombobox(props: { state: EventFormState }) {
  const s = props.state;
  let inputRef: HTMLInputElement | undefined;
  const [inputValue, setInputValue] = createSignal("");
  const [query, setQuery] = createSignal("");
  // Only mirror highlighted item into input on explicit navigation (hover/arrow),
  // not when autohighlight fires after typing.
  let userNavigated = false;

  const suggestions = createMemo(() => {
    const parts = extractReminderParts(query().trim().toLowerCase());

    if (parts) {
      const { num, unit, compound } = parts;

      // Compound expression — already resolved to total minutes
      if (compound) {
        return num <= MAX_REMINDER_MINUTES
          ? [{ value: String(num), label: formatReminderValue(num) }]
          : [];
      }

      const allCandidates = [
        { minutes: num, label: `${num} min`, u: "m" },
        { minutes: num * 60, label: `${num} hour${num !== 1 ? "s" : ""}`, u: "h" },
        { minutes: num * 1440, label: `${num} day${num !== 1 ? "s" : ""}`, u: "d" },
        { minutes: num * 10080, label: `${num} week${num !== 1 ? "s" : ""}`, u: "w" },
      ];

      // If a unit was detected, narrow to just that match
      const candidates = unit
        ? allCandidates.filter((c) => c.u === unit)
        : allCandidates;

      return candidates
        .filter((c) => c.minutes <= MAX_REMINDER_MINUTES)
        .map((c) => ({ value: String(c.minutes), label: c.label }));
    }

    return REMINDER_PRESETS.map(
      (p) => ({ value: String(p.minutes), label: p.label }),
    );
  });

  // Ark UI's combobox internally filters items via `itemToString().includes(input)`.
  // Since we already compute the right suggestions ourselves, prepend the raw query
  // so every item passes Ark's matching — prevents it from hiding our pre-filtered items.
  const collection = createMemo(() => {
    const q = query().toLowerCase();
    return createListCollection({
      items: suggestions(),
      itemToValue: (item) => item.value,
      itemToString: (item) => q ? `${q} ${item.label}` : item.label,
    });
  });

  function handleAdd(minutes: number): void {
    if (minutes > 0 && !s.reminders().some((r) => r.minutes === minutes)) {
      s.addReminder(minutes);
    }
    setInputValue("");
    setQuery("");
  }

  return (
    <Combobox.Root
      collection={collection()}
      value={[]}
      allowCustomValue
      openOnClick
      closeOnSelect
      inputBehavior="autohighlight"
      onHighlightChange={(d) => {
        if (d.highlightedValue != null && userNavigated) {
          const item = suggestions().find((i) => i.value === d.highlightedValue);
          if (item) {
            setInputValue(item.label);
            requestAnimationFrame(() => inputRef?.select());
          }
        }
      }}
      inputValue={inputValue()}
      onInputValueChange={(d) => {
        // User typed — reset navigation flag so autohighlight doesn't mirror
        userNavigated = false;

        setInputValue(d.inputValue);
        setQuery(d.inputValue);
      }}
      onValueChange={(details) => {
        const val = details.value[0];
        if (!val) return;
        const minutes = parseReminderInput(val);
        if (minutes) handleAdd(minutes);
      }}
      onOpenChange={(d) => {
        if (!d.open) {
          setInputValue("");
          setQuery("");
        }
      }}
      positioning={{ placement: "bottom-start", sameWidth: true }}
    >
      <Combobox.Control class="flex items-center gap-2 rounded px-2 py-2 hover:bg-surface-hover focus-within:bg-surface-hover transition-colors">
        <Bell size={14} class="text-fg-muted shrink-0" />
        <Combobox.Input
          ref={(el) => { inputRef = el; }}
          placeholder="Reminders"
          aria-label="Reminders"
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") userNavigated = true;
          }}
          class="flex-1 text-sm text-fg placeholder-fg-disabled bg-transparent outline-none border-none cursor-text"
        />
      </Combobox.Control>
      <Combobox.Positioner>
        <Combobox.Content
          class="bg-surface border border-border rounded py-1 z-50 min-w-[160px]"
          onPointerMove={() => { userNavigated = true; }}
        >
          <For each={suggestions()}>
            {(item) => (
              <Combobox.Item
                item={item}
                class="flex items-center px-3 py-1.5 text-xs text-fg cursor-pointer hover:bg-surface-hover data-[highlighted]:bg-surface-hover outline-none"
              >
                <Combobox.ItemText>
                  {item.label}<span class="text-fg-disabled"> before</span>
                </Combobox.ItemText>
              </Combobox.Item>
            )}
          </For>
        </Combobox.Content>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}

// =============================================================================
// Time combobox
// =============================================================================

const TIME_SLOTS = Array.from({ length: 48 }, (_, i) => {
  const hours = Math.floor(i / 2);
  const minutes = (i % 2) * 30;
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  const time = minutes === 0
    ? `${displayHour}`
    : `${displayHour}:${minutes.toString().padStart(2, "0")}`;
  return { value: `${hours}:${minutes.toString().padStart(2, "0")}`, label: `${time} ${period}`, time, period };
});

/** Sort TIME_SLOTS by proximity to a target time (in total minutes). */
function slotsByProximity(targetMinutes: number): typeof TIME_SLOTS {
  return [...TIME_SLOTS].sort((a, b) => {
    const [aH, aM] = a.value.split(":").map(Number);
    const [bH, bM] = b.value.split(":").map(Number);
    return Math.abs(aH * 60 + aM - targetMinutes) - Math.abs(bH * 60 + bM - targetMinutes);
  });
}

/** Format hours/minutes to a 12h display label with separate time/period parts. */
function formatHM(hours: number, minutes: number): { label: string; time: string; period: string } {
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  const time = minutes === 0
    ? `${displayHour}`
    : `${displayHour}:${minutes.toString().padStart(2, "0")}`;
  return { label: `${time} ${period}`, time, period };
}

function TimeCombobox(props: {
  date: () => Date;
  timeZone: () => string | undefined;
  which: "start" | "end";
  ariaLabel: string;
  state: EventFormState;
  /** Reference hour for AM/PM inference on ambiguous input (e.g. "3" → 3 PM if ref is 14). */
  referenceHour: () => number;
  /** Exclude suggestions at or before this many minutes since midnight (for end-time filtering). */
  excludeBeforeMinutes?: () => number;
}) {
  const s = props.state;
  let inputRef: HTMLInputElement | undefined;

  const displayTime = () => formatTime(props.date(), props.timeZone());
  const [inputValue, setInputValue] = createSignal(displayTime());
  const [query, setQuery] = createSignal("");
  const [isEditing, setIsEditing] = createSignal(false);
  const [highlighted, setHighlighted] = createSignal<string | null>(null);
  // Only mirror highlighted item into input when user explicitly navigated
  // (hover or arrow keys), not when autohighlight fires after typing.
  let userNavigated = false;

  // Sync display when date/timezone changes externally (e.g., drag)
  createEffect(() => {
    const time = displayTime();
    if (!isEditing()) {
      setInputValue(time);
    }
  });

  // Always returns items — never an empty list.
  // First item is always the parsed interpretation of the typed input,
  // followed by nearby 30-min slots. Autohighlight highlights the first
  // item, so Enter commits the parsed value (e.g. "6:2" → "6:02 AM").
  // For end-time, slots at or before the start time are excluded.
  // Uses `query` (user-typed text) not `inputValue` (which also reflects highlights).
  const filtered = createMemo(() => {
    const q = query().toLowerCase().trim();
    let items: typeof TIME_SLOTS;

    if (!q) {
      items = TIME_SLOTS;
    } else {
      const parsed = parseTimeInput(q, props.referenceHour());

      if (parsed) {
        const targetMinutes = parsed.hours * 60 + parsed.minutes;
        const value = `${parsed.hours}:${parsed.minutes.toString().padStart(2, "0")}`;
        const parts = formatHM(parsed.hours, parsed.minutes);

        // Check if parsed time matches an existing 30-min slot
        const existingSlot = TIME_SLOTS.find(slot => slot.value === value);
        const nearby = slotsByProximity(targetMinutes);

        if (existingSlot) {
          items = [existingSlot, ...nearby.filter(slot => slot.value !== value)];
        } else {
          items = [{ value, ...parts }, ...nearby];
        }
      } else {
        // Not parseable — try label matching, then all slots
        const labelMatches = TIME_SLOTS.filter(slot =>
          slot.label.toLowerCase().includes(q)
        );
        items = labelMatches.length > 0 ? labelMatches : TIME_SLOTS;
      }
    }

    // For end-time: exclude slots at or before the start time
    const minMin = props.excludeBeforeMinutes?.();
    if (minMin !== undefined) {
      const valid = items.filter(item => {
        const [h, m] = item.value.split(":").map(Number);
        return h * 60 + m > minMin;
      });
      if (valid.length > 0) return valid;
    }

    return items;
  });

  const collection = createMemo(() =>
    createListCollection({
      items: filtered(),
      itemToValue: (item) => item.value,
      itemToString: (item) => item.label,
    })
  );

  function commit(): void {
    if (!isEditing()) return;
    setIsEditing(false);
    s.finishTimeEdit();
    setInputValue(displayTime());
    setQuery("");
  }

  return (
    <Combobox.Root
      collection={collection()}
      allowCustomValue
      openOnClick
      closeOnSelect
      value={[]}
      inputBehavior="autohighlight"
      highlightedValue={highlighted()}
      onHighlightChange={(d) => {
        if (d.highlightedValue != null) {
          setHighlighted(d.highlightedValue);
          // Mirror highlight into input only on explicit navigation (hover/arrow),
          // not on autohighlight after typing
          if (userNavigated) {
            const item = filtered().find(i => i.value === d.highlightedValue);
            if (item) setInputValue(item.label);
          }
        }
      }}
      inputValue={inputValue()}
      onInputValueChange={(d) => {
        if (!isEditing()) return;
        // User typed — reset navigation flag so autohighlight doesn't mirror
        userNavigated = false;
        setInputValue(d.inputValue);
        setQuery(d.inputValue);
        if (d.inputValue) {
          s.handleTimeInput(props.which, d.inputValue, props.referenceHour());
        }
      }}
      onValueChange={(d) => {
        const val = d.value[0];
        if (!val) return;
        // Apply the selected time (from click, arrow+Enter, or autohighlight+Enter)
        s.handleTimeInput(props.which, val);
        commit();
        inputRef?.blur();
      }}
      positioning={{ placement: "bottom-start" }}
    >
      <Combobox.Control>
        <Combobox.Input
          ref={(el) => { inputRef = el; }}
          aria-label={props.ariaLabel}
          onFocus={(e) => {
            setIsEditing(true);
            setQuery(displayTime());
            s.beginTimeEdit();
            const items = filtered();
            if (items.length > 0) setHighlighted(items[0].value);
            const el = e.currentTarget;
            requestAnimationFrame(() => el?.select());
          }}
          onBlur={() => commit()}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              userNavigated = true;
            } else if (e.key === "Escape") {
              e.preventDefault();
              setIsEditing(false);
              s.revertTimeEdit();
              setInputValue(displayTime());
              setQuery("");
              (e.target as HTMLElement).blur();
            }
          }}
          class="w-[4.5rem] text-sm text-fg bg-transparent rounded px-0.5 py-0 border-none outline-none hover:bg-surface-hover focus:bg-surface-input transition-colors text-left cursor-text"
        />
      </Combobox.Control>
      <Combobox.Positioner>
        <Combobox.Content
          class="bg-surface border border-border rounded py-1 z-50 max-h-48 overflow-y-auto min-w-[120px]"
          onPointerMove={() => { userNavigated = true; }}
        >
          <For each={filtered()}>
            {(item) => (
              <Combobox.Item
                item={item}
                class="flex items-center px-3 py-1.5 text-xs cursor-pointer data-[highlighted]:bg-surface-hover outline-none"
              >
                <span class="w-8 tabular-nums text-fg">{item.time}</span>
                <span class="ml-1.5 text-[10px] text-fg-disabled">{item.period}</span>
              </Combobox.Item>
            )}
          </For>
        </Combobox.Content>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}

// =============================================================================
// Timezone selector
// =============================================================================

import { SYSTEM_TIMEZONE } from "../../constants/calendar";

/** Day offset between local and event timezone: +1 = local is one day ahead (flight-style). */
function getLocalDayOffset(date: Date, eventTz: string): number {
  const dayEpoch = (tz: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "numeric", day: "numeric",
    }).formatToParts(date);
    const y = parseInt(parts.find(p => p.type === "year")?.value ?? "2000");
    const m = parseInt(parts.find(p => p.type === "month")?.value ?? "1") - 1;
    const d = parseInt(parts.find(p => p.type === "day")?.value ?? "1");
    return Date.UTC(y, m, d);
  };
  return Math.round((dayEpoch(SYSTEM_TIMEZONE) - dayEpoch(eventTz)) / 86400000);
}

function formatTimezoneLabel(tz: string): string {
  const city = tz.split("/").pop()!.replace(/_/g, " ");
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    });
    const parts = formatter.formatToParts(new Date());
    const offset = parts.find(p => p.type === "timeZoneName")?.value ?? "GMT";
    return `${city} (${offset})`;
  } catch {
    return city;
  }
}

let _timezoneCache: { value: string; label: string }[] | null = null;
function getTimezoneItems(): { value: string; label: string }[] {
  if (_timezoneCache) return _timezoneCache;
  _timezoneCache = Intl.supportedValuesOf("timeZone")
    .map(tz => ({ value: tz, label: formatTimezoneLabel(tz) }))
    .sort((a, b) => {
      const cityA = a.value.split("/").pop()!;
      const cityB = b.value.split("/").pop()!;
      return cityA.localeCompare(cityB);
    });
  return _timezoneCache;
}

function TimezoneSelector(props: { state: EventFormState }) {
  const s = props.state;
  let inputRef: HTMLInputElement | undefined;
  let contentRef: HTMLElement | undefined;
  const displayTz = () => s.timeZone() || SYSTEM_TIMEZONE;
  const displayLabel = () => formatTimezoneLabel(displayTz());

  const [inputValue, setInputValue] = createSignal(displayLabel());
  const [query, setQuery] = createSignal("");
  const [isEditing, setIsEditing] = createSignal(false);
  const [highlighted, setHighlighted] = createSignal<string | null>(null);
  // Only mirror highlighted item into input when user explicitly navigated
  // (hover or arrow keys), not when autohighlight fires after typing.
  let userNavigated = false;
  // Zag's setFinalFocus refocuses the input after commit, which would
  // re-trigger onFocus and clear the display. This flag skips that refocus.
  let skipNextFocus = false;

  // Sync display when timezone changes externally
  createEffect(() => {
    const label = displayLabel();
    if (!isEditing()) setInputValue(label);
  });

  const allTimezones = getTimezoneItems();

  const filtered = createMemo(() => {
    if (!isEditing()) return allTimezones;
    const q = query().toLowerCase().trim();
    if (!q) return allTimezones;
    // Rank: city prefix > label prefix > substring match
    const prefixMatches: typeof allTimezones = [];
    const substringMatches: typeof allTimezones = [];
    for (const tz of allTimezones) {
      const city = tz.value.split("/").pop()!.toLowerCase().replace(/_/g, " ");
      if (city.startsWith(q) || tz.label.toLowerCase().startsWith(q)) {
        prefixMatches.push(tz);
      } else if (
        tz.value.toLowerCase().replace(/_/g, " ").includes(q) ||
        tz.label.toLowerCase().includes(q)
      ) {
        substringMatches.push(tz);
      }
    }
    return [...prefixMatches, ...substringMatches];
  });

  const collection = createMemo(() =>
    createListCollection({
      items: filtered(),
      itemToValue: (item) => item.value,
      itemToString: (item) => item.label,
    })
  );

  function commit(): void {
    if (!isEditing()) return;
    setIsEditing(false);
    setInputValue(displayLabel());
    setQuery("");
    // Zag's setFinalFocus will refocus the input on the next frame.
    // Skip the resulting onFocus so it doesn't clear our display.
    skipNextFocus = true;
  }

  return (
    <Combobox.Root
      collection={collection()}
      allowCustomValue
      openOnClick
      closeOnSelect
      value={[]}
      inputBehavior="autohighlight"
      highlightedValue={highlighted()}
      onHighlightChange={(d) => {
        if (d.highlightedValue != null) {
          setHighlighted(d.highlightedValue);
          // Mirror highlight into input only on explicit navigation (hover/arrow),
          // not on autohighlight after typing
          if (userNavigated) {
            const item = filtered().find(i => i.value === d.highlightedValue);
            if (item) setInputValue(item.label);
          }
        }
      }}
      inputValue={inputValue()}
      onInputValueChange={(d) => {
        if (!isEditing()) return;
        // User typed — reset navigation flag so autohighlight doesn't mirror
        userNavigated = false;
        setInputValue(d.inputValue);
        setQuery(d.inputValue);
      }}
      onValueChange={(d) => {
        const tz = d.value[0];
        if (tz && allTimezones.some(t => t.value === tz)) {
          s.setTimeZone(tz);
        }
        commit();
        inputRef?.blur();
      }}
      onOpenChange={(d) => {
        if (d.open) {
          // Scroll to current timezone once the dropdown renders
          requestAnimationFrame(() => {
            const el = contentRef?.querySelector("[data-highlighted]") as HTMLElement | null;
            el?.scrollIntoView({ block: "start" });
          });
        } else {
          commit();
        }
      }}
      positioning={{ placement: "bottom-start" }}
    >
      <Combobox.Control class="flex items-center gap-2 rounded px-2 py-2 hover:bg-surface-hover focus-within:bg-surface-hover transition-colors">
        <Globe size={14} class="text-fg-muted shrink-0" />
        <Combobox.Input
          ref={(el) => { inputRef = el; }}
          placeholder="Search timezone…"
          aria-label="Timezone"
          onFocus={(e) => {
            if (skipNextFocus) {
              skipNextFocus = false;
              return;
            }
            setIsEditing(true);
            setInputValue("");
            setQuery("");
            // Pre-highlight current timezone so it's scrolled-to when dropdown opens
            setHighlighted(displayTz());
            requestAnimationFrame(() => e.currentTarget?.select());
          }}
          onBlur={() => commit()}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              userNavigated = true;
            }
          }}
          class={`flex-1 text-sm bg-transparent outline-none border-none cursor-text placeholder-fg-disabled ${
            isEditing() ? "text-fg" : "text-fg-muted"
          }`}
        />
      </Combobox.Control>
      <Combobox.Positioner>
        <Combobox.Content
          ref={(el) => { contentRef = el; }}
          class="bg-surface border border-border rounded py-1 z-50 max-h-48 overflow-y-auto min-w-[220px]"
          onPointerMove={() => { userNavigated = true; }}
        >
          <For each={filtered()}>
            {(item) => (
              <Combobox.Item
                item={item}
                class="flex items-center px-3 py-1.5 text-xs text-fg cursor-pointer data-[highlighted]:bg-surface-hover outline-none"
              >
                <Combobox.ItemText>{item.label}</Combobox.ItemText>
              </Combobox.Item>
            )}
          </For>
        </Combobox.Content>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}

const MONTH_NAMES_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function RecurrenceSelector(props: SectionProps) {
  const s = props.state;
  const [customOpen, setCustomOpen] = createSignal(false);

  const isEditing = () => s.mode() === "edit";

  // Whether this is a recurring event instance (has recurringEventId).
  // With singleEvents=true, all recurring occurrences are instances — they
  // carry recurringEventId but no recurrence array (the RRULE lives on the
  // master). Editing recurrence on an instance routes to the master via
  // "all" scope, so the selector should still be interactive.
  const isRecurringInstance = () => {
    if (!isEditing()) return false;
    const ev = selectedEvent();
    return !!ev?.recurringEventId;
  };

  // Generate contextual presets based on the event start date
  const presets = createMemo(() => {
    const start = s.start();
    if (!start) return [];
    const dayName = DAY_NAMES_FULL[start.getDay()];
    const dayCode = dayCodeFromDate(start);
    const monthDay = `${MONTH_NAMES_SHORT[start.getMonth()]} ${start.getDate()}`;

    return [
      { value: "none", label: "Does not repeat", rrule: null as string[] | null },
      { value: "daily", label: "Daily", rrule: ["RRULE:FREQ=DAILY"] },
      { value: "weekdays", label: "Every weekday (Mon\u2013Fri)", rrule: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"] },
      { value: "weekly", label: `Weekly on ${dayName}`, rrule: [`RRULE:FREQ=WEEKLY;BYDAY=${dayCode}`] },
      { value: "monthly", label: `Monthly on the ${ordinal(start.getDate())}`, rrule: [`RRULE:FREQ=MONTHLY;BYMONTHDAY=${start.getDate()}`] },
      { value: "yearly", label: `Annually on ${monthDay}`, rrule: ["RRULE:FREQ=YEARLY"] },
      { value: "custom", label: "Custom\u2026", rrule: null as string[] | null },
    ];
  });

  const currentLabel = createMemo(() => {
    const rec = s.recurrence();
    if (rec) return s.start() ? formatRecurrence(rec, s.start()!) : "Repeats";
    // Instances don't carry the RRULE — look up master event's recurrence
    if (isRecurringInstance()) {
      const recurringId = selectedEvent()?.recurringEventId;
      if (recurringId) {
        const master = events().find(e => e.id === recurringId);
        if (master?.recurrence && s.start()) return formatRecurrence(master.recurrence, s.start()!);
      }
      return "Repeats";
    }
    return "Does not repeat";
  });

  const currentValue = createMemo(() => {
    const rec = s.recurrence();
    if (!rec) return "none";
    const rrule = rec[0];
    const match = presets().find(p => p.rrule && p.rrule[0] === rrule);
    return match?.value ?? "custom";
  });

  const handleSelect = (value: string) => {
    if (value === "custom") {
      setCustomOpen(true);
      return;
    }
    const preset = presets().find(p => p.value === value);
    if (!preset) return;
    // For recurring instances, "none" → null is a real change even though
    // currentValue is already "none" (instances don't carry the RRULE).
    // Ark UI won't fire onValueChange for same-value, so this is only
    // reached when the value actually differs or the component is forced.
    s.setRecurrence(preset.rrule);
  };

  // Ark UI Select won't fire onValueChange when picking the already-selected value.
  // For recurring instances, currentValue is "none" (no RRULE on instance) but
  // selecting "Does not repeat" IS a meaningful change (removes recurrence from the series).
  // Use onInteractOutside as a fallback won't work — instead, use an Item click handler.
  const handleItemClick = (value: string) => {
    if (value === currentValue() && isRecurringInstance()) {
      handleSelect(value);
    }
  };

  const handleCustomDone = (rrule: string[]) => {
    s.setRecurrence(rrule);
    setCustomOpen(false);
  };

  const collection = createMemo(() =>
    createListCollection({
      items: presets(),
      itemToValue: (item) => item.value,
      itemToString: (item) => item.label,
    })
  );

  // Read-only only when user is not the organizer
  const readOnly = () => isEditing() && !s.isOrganizer();

  return (
    <Show when={!readOnly()} fallback={
      <div class="flex w-full items-center gap-2 text-sm text-fg-muted rounded px-2 py-2">
        <Repeat size={14} class="shrink-0" />
        <span>{currentLabel()}</span>
      </div>
    }>
      <Select.Root
        collection={collection()}
        value={[currentValue()]}
        onValueChange={(details) => {
          handleSelect(details.value[0]);
        }}
        positioning={{ placement: "bottom-start" }}
      >
        <Select.Control>
          <Select.Trigger
            aria-label="Repeat"
            class="flex w-full items-center gap-2 text-sm bg-transparent outline-none border-none cursor-pointer rounded px-2 py-2 hover:bg-surface-hover transition-colors text-fg-muted hover:text-fg"
          >
            <Repeat size={14} class="shrink-0" />
            <span class="flex-1 text-left">{currentLabel()}</span>
            <ChevronDown size={14} class="text-fg-muted shrink-0" />
          </Select.Trigger>
        </Select.Control>
        <Select.Positioner>
          <Select.Content class="bg-surface border border-border rounded py-1 z-50">
            <For each={presets()}>
              {(item) => (
                <Select.Item
                  item={item}
                  class={`flex items-center px-3 py-1.5 text-xs text-fg cursor-pointer hover:bg-surface-hover data-[highlighted]:bg-surface-hover outline-none${item.value === "custom" ? " border-t border-border mt-1 pt-1.5" : ""}`}
                  onClick={() => handleItemClick(item.value)}
                >
                  <Select.ItemText>{item.label}</Select.ItemText>
                </Select.Item>
              )}
            </For>
          </Select.Content>
        </Select.Positioner>
        <Select.HiddenSelect />
      </Select.Root>
      <Show when={s.start()}>
        {(start) => (
          <CustomRecurrenceDialog
            open={customOpen()}
            onClose={() => setCustomOpen(false)}
            onDone={handleCustomDone}
            eventStart={start()}
          />
        )}
      </Show>
    </Show>
  );
}
