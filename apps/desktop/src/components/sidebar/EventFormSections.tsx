import { Show, For, createSignal, createMemo } from "solid-js";
import {
  Clock,
  ArrowRight,
  Users,
  Video,
  MapPin,
  Bell,
  ChevronDown,
  Globe,
  Lock,
  Copy,
  Calendar,
  LoaderCircle,
} from "lucide-solid";
import { Switch } from "@ark-ui/solid/switch";
import { Select, createListCollection } from "@ark-ui/solid/select";
import { Combobox } from "@ark-ui/solid/combobox";
import { Popover } from "@ark-ui/solid/popover";
import { X } from "lucide-solid";
import { invoke } from "@tauri-apps/api/core";
import { CATHRIN_PALETTE } from "../../lib/color-mapping";
import type { CathrinColorKey } from "../../lib/color-mapping";
import { setDraftStart, setDraftEnd } from "../../stores/event-creation";
import { formatTime, formatDuration, formatDate } from "../../lib/format-utils";
import type { EventFormState } from "./useEventFormState";

interface SectionProps {
  state: EventFormState;
}

export function TimeSection(props: SectionProps) {
  const s = props.state;

  return (
    <div class="px-3 py-3 border-t border-border space-y-1.5">
      {/* Start time + End time on one row (hidden for all-day) */}
      <Show when={s.start() && s.end() && !s.isAllDay()}>
        <div class="flex items-center gap-2 text-sm text-fg">
          <Clock size={14} class="text-fg-muted shrink-0" />
          {/* Start time: click-to-edit with live updates */}
          <Show
            when={s.editingTime() === "start"}
            fallback={
              <span
                role="button"
                tabIndex={0}
                aria-label="Start time"
                class="whitespace-nowrap cursor-pointer hover:bg-surface-hover rounded px-0.5 -mx-0.5"
                onClick={() => s.beginTimeEdit("start")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    s.beginTimeEdit("start");
                  }
                }}
              >
                {formatTime(s.start()!)}
              </span>
            }
          >
            <input
              type="text"
              inputMode="numeric"
              aria-label="Start time"
              value={s.startTimeText()}
              ref={(el) =>
                requestAnimationFrame(() => {
                  el.focus();
                  el.select();
                })
              }
              onInput={(e) => s.handleTimeInput("start", e.currentTarget.value)}
              onBlur={() => s.finishTimeEdit()}
              onKeyDown={s.handleTimeKeyDown}
              placeholder="0:00"
              class="text-sm text-fg bg-surface-input rounded px-1 py-0 border-none outline-none hover:bg-surface-hover focus:bg-surface-hover transition-colors w-[4rem] text-center"
            />
          </Show>
          <ArrowRight size={14} class="text-fg-muted shrink-0" />
          {/* End time: click-to-edit with live updates */}
          <Show
            when={s.editingTime() === "end"}
            fallback={
              <span
                role="button"
                tabIndex={0}
                aria-label="End time"
                class="whitespace-nowrap cursor-pointer hover:bg-surface-hover rounded px-0.5 -mx-0.5"
                onClick={() => s.beginTimeEdit("end")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    s.beginTimeEdit("end");
                  }
                }}
              >
                {formatTime(s.end()!)}
              </span>
            }
          >
            <input
              type="text"
              inputMode="numeric"
              aria-label="End time"
              value={s.endTimeText()}
              ref={(el) =>
                requestAnimationFrame(() => {
                  el.focus();
                  el.select();
                })
              }
              onInput={(e) => s.handleTimeInput("end", e.currentTarget.value)}
              onBlur={() => s.finishTimeEdit()}
              onKeyDown={s.handleTimeKeyDown}
              placeholder="0:00"
              class="text-sm text-fg bg-surface-input rounded px-1 py-0 border-none outline-none hover:bg-surface-hover focus:bg-surface-hover transition-colors w-[4rem] text-center"
            />
          </Show>
          <Show when={formatDate(s.start()!) === formatDate(s.end()!)}>
            <span class="text-xs text-fg-muted whitespace-nowrap">
              {formatDuration(s.start()!, s.end()!)}
            </span>
          </Show>
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
          <span>{formatDate(s.start()!)}</span>
          <Show when={formatDate(s.start()!) !== formatDate(s.end()!)}>
            <span>{formatDate(s.end()!)}</span>
          </Show>
        </div>
      </Show>
      {/* All-day toggle + stubs */}
      <div class="ml-[22px] flex items-center gap-3 text-xs">
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
          class="inline-flex items-center gap-1.5 cursor-pointer"
        >
          <Switch.Label class="text-xs text-fg-disabled cursor-pointer">
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
        <button class="text-fg-muted cursor-pointer rounded px-2 py-2 hover:text-fg hover:bg-surface-hover transition-colors">
          Time zone
        </button>
        <button class="text-fg-muted cursor-pointer rounded px-2 py-2 hover:text-fg hover:bg-surface-hover transition-colors">
          Repeat
        </button>
      </div>
    </div>
  );
}

export function DetailsSection(props: SectionProps) {
  const s = props.state;

  return (
    <div class="px-3 py-3 border-t border-border space-y-2">
      <button class="flex w-full items-center gap-2 text-sm text-fg-muted cursor-pointer rounded px-2 py-2 hover:text-fg hover:bg-surface-hover transition-colors">
        <Users size={14} class="shrink-0" />
        <span>Participants</span>
      </button>
      <ConferencingField state={s} />
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
          class="flex-1 text-sm text-fg placeholder-fg-disabled bg-transparent outline-none border-none"
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
        class="w-full text-sm text-fg placeholder-fg-disabled bg-surface-input appearance-none outline-none border-none resize-none overflow-hidden rounded px-2 py-1 hover:bg-surface-hover focus:bg-surface-hover transition-colors"
        rows={2}
      />
    </div>
  );
}

export function CalendarSection(props: SectionProps) {
  const s = props.state;

  return (
    <div class="px-3 py-3 border-t border-border">
      <div class="flex items-center">
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
          <Select.Control class="flex-1">
            <Select.Trigger
              aria-label="Free/Busy status"
              class="flex items-center gap-1 text-xs bg-transparent outline-none border-none cursor-pointer rounded px-2 py-2 hover:bg-surface-hover transition-colors text-fg-muted hover:text-fg"
            >
              <span>{s.transparency() === "opaque" ? "Busy" : "Free"}</span>
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
        <Select.Root
          collection={s.visibilityCollection()}
          value={[s.visibility()]}
          onValueChange={(details) => {
            const val = details.value[0];
            if (val === "default" || val === "public" || val === "private") {
              s.setVisibility(val);
            }
          }}
          positioning={{ placement: "bottom-start" }}
        >
          <Select.Control class="flex-1">
            <Select.Trigger class="flex items-center gap-1 text-xs bg-transparent outline-none border-none cursor-pointer rounded px-2 py-2 hover:bg-surface-hover transition-colors text-fg-muted hover:text-fg">
              <Show when={s.visibility() === "private"}>
                <Lock size={14} class="shrink-0" />
              </Show>
              <Show when={s.visibility() === "public"}>
                <Globe size={14} class="shrink-0" />
              </Show>
              <span>
                {s.visibility() === "default"
                  ? "Default visibility"
                  : s.visibility() === "public"
                    ? "Public"
                    : "Private"}
              </span>
              <ChevronDown size={14} class="text-fg-muted shrink-0" />
            </Select.Trigger>
          </Select.Control>
          <Select.Positioner>
            <Select.Content class="bg-surface border border-border rounded py-1 z-50">
              <For each={s.visibilityCollection().items}>
                {(item) => (
                  <Select.Item
                    item={item}
                    class="flex items-center gap-2 px-3 py-1.5 text-xs text-fg cursor-pointer hover:bg-surface-hover data-[highlighted]:bg-surface-hover outline-none"
                  >
                    <Show when={item.value === "public"}>
                      <Globe size={14} class="shrink-0" />
                    </Show>
                    <Show when={item.value === "private"}>
                      <Lock size={14} class="shrink-0" />
                    </Show>
                    <Show when={item.value === "default"}>
                      <span class="w-3.5" />
                    </Show>
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
  );
}

const REMINDER_PRESETS = [
  { minutes: 5, label: "5 min" },
  { minutes: 10, label: "10 min" },
  { minutes: 15, label: "15 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: "1 hour" },
  { minutes: 1440, label: "1 day" },
];

function formatReminderValue(minutes: number): string {
  if (minutes >= 1440) return `${minutes / 1440} day`;
  if (minutes >= 60) return `${minutes / 60}hr`;
  return `${minutes}min`;
}

function parseReminderInput(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  const match = trimmed.match(
    /^(\d+)\s*(min|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?/,
  );
  if (!match) return null;
  const num = parseInt(match[1], 10);
  if (num <= 0 || isNaN(num)) return null;
  const unit = match[2];
  if (!unit) return num; // bare number → minutes
  if (unit.startsWith("h")) return num * 60;
  if (unit.startsWith("d")) return num * 1440;
  return num;
}

export function RemindersSection(props: SectionProps) {
  const s = props.state;

  return (
    <div class="px-3 py-3 border-t border-border space-y-1">
      <Show when={s.reminders().length < 5}>
        <ReminderCombobox state={s} />
      </Show>
      <Show when={s.reminders().length > 0}>
        <div class="ml-[22px] flex flex-wrap gap-1">
          <For each={s.reminders()}>
            {(r) => (
              <span
                class="inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 bg-surface-hover text-fg"
                aria-label={`${formatReminderValue(r.minutes)} before, press delete to remove`}
              >
                {formatReminderValue(r.minutes)}{" "}
                <span class="text-fg-muted">before</span>
                <button
                  class="text-fg-muted hover:text-fg transition-colors cursor-pointer p-1.5"
                  onClick={() => s.removeReminder(r.minutes)}
                  aria-label={`Remove ${formatReminderValue(r.minutes)} before reminder`}
                >
                  <X size={12} />
                </button>
              </span>
            )}
          </For>
        </div>
      </Show>
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
        <Popover.Content class="bg-surface border border-border rounded p-2 z-50 max-w-[208px]">
          <div class="flex items-center gap-3 flex-wrap">
            {/* Calendar default — dashed outline to distinguish */}
            <Popover.CloseTrigger
              class="w-5 h-5 rounded-full cursor-pointer shrink-0 transition-transform hover:scale-125 bg-transparent outline-none"
              style={{
                border: `1.5px dashed ${s.calendarColor()}`,
                "box-shadow": isSelected(null)
                  ? `0 0 0 2px var(--color-surface), 0 0 0 3.5px ${s.calendarColor()}`
                  : undefined,
              }}
              title="Calendar default"
              onClick={() => s.setColorId(null)}
            />
            {/* Other palette colors */}
            <For each={otherSwatches()}>
              {(swatch) => (
                <Popover.CloseTrigger
                  class="w-5 h-5 rounded-full cursor-pointer shrink-0 transition-transform hover:scale-125 bg-transparent border-none outline-none"
                  style={ringStyle(
                    CATHRIN_PALETTE[swatch.key],
                    isSelected(swatch.key),
                    "full",
                  )}
                  title={swatch.label}
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
  const [inputValue, setInputValue] = createSignal("");

  const suggestions = createMemo(() => {
    const existing = s.reminders().map((r) => r.minutes);
    const text = inputValue().trim();
    const num = parseInt(text, 10);

    if (num > 0 && !isNaN(num)) {
      const items: { value: string; label: string }[] = [];
      if (!existing.includes(num))
        items.push({ value: String(num), label: `${num} min before` });
      if (!existing.includes(num * 60))
        items.push({
          value: String(num * 60),
          label: `${num} hour${num !== 1 ? "s" : ""} before`,
        });
      if (!existing.includes(num * 1440))
        items.push({
          value: String(num * 1440),
          label: `${num} day${num !== 1 ? "s" : ""} before`,
        });
      return items;
    }

    return REMINDER_PRESETS.filter((p) => !existing.includes(p.minutes)).map(
      (p) => ({ value: String(p.minutes), label: `${p.label} before` }),
    );
  });

  const collection = createMemo(() =>
    createListCollection({
      items: suggestions(),
      itemToValue: (item) => item.value,
      itemToString: (item) => item.label,
    }),
  );

  function handleAdd(minutes: number): void {
    if (minutes > 0 && !s.reminders().some((r) => r.minutes === minutes)) {
      s.addReminder(minutes);
    }
    setInputValue("");
  }

  return (
    <Combobox.Root
      collection={collection()}
      allowCustomValue
      openOnClick
      closeOnSelect
      selectionBehavior="clear"
      inputBehavior="autohighlight"
      inputValue={inputValue()}
      onInputValueChange={(details) => setInputValue(details.inputValue)}
      onValueChange={(details) => {
        const val = details.value[0];
        if (!val) return;
        const minutes = parseReminderInput(val);
        if (minutes) handleAdd(minutes);
      }}
      positioning={{ placement: "bottom-start", sameWidth: true }}
    >
      <Combobox.Control class="flex items-center gap-2 rounded px-2 py-2">
        <Bell size={14} class="text-fg-muted shrink-0" />
        <Combobox.Input
          placeholder="Reminders"
          aria-label="Reminders"
          class="flex-1 text-sm text-fg placeholder-fg-disabled bg-surface-input outline-none border-none rounded px-2 py-1 hover:bg-surface-hover focus:bg-surface-hover transition-colors cursor-text"
        />
      </Combobox.Control>
      <Combobox.Positioner>
        <Combobox.Content class="bg-surface border border-border rounded py-1 z-50 min-w-[160px]">
          <For each={suggestions()}>
            {(item) => (
              <Combobox.Item
                item={item}
                class="flex items-center px-3 py-1.5 text-xs text-fg cursor-pointer hover:bg-surface-hover data-[highlighted]:bg-surface-hover outline-none"
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
