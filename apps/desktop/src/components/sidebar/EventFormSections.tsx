import { Show, For } from "solid-js";
import {
  Clock,
  ArrowRight,
  Users,
  Video,
  MapPin,
  FileText,
  AlignLeft,
  Bell,
  ChevronDown,
} from "lucide-solid";
import { Switch } from "@ark-ui/solid/switch";
import { Select } from "@ark-ui/solid/select";
import {
  setDraftStart,
  setDraftEnd,
} from "../../stores/event-creation";
import {
  formatTime,
  formatDuration,
  formatDate,
} from "../../lib/format-utils";
import type { EventFormState } from "./useEventFormState";

interface SectionProps {
  state: EventFormState;
}

export function TimeSection(props: SectionProps) {
  const s = props.state;

  return (
    <div class="px-3 py-2 border-t border-border space-y-1.5">
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
              ref={(el) => requestAnimationFrame(() => { el.focus(); el.select(); })}
              onInput={(e) => s.handleTimeInput("start", e.currentTarget.value)}
              onBlur={() => s.finishTimeEdit()}
              onKeyDown={s.handleTimeKeyDown}
              placeholder="0:00"
              class="text-sm text-fg bg-surface-input rounded px-1 py-0 border border-border outline-none focus:border-accent w-[4rem] text-center"
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
              ref={(el) => requestAnimationFrame(() => { el.focus(); el.select(); })}
              onInput={(e) => s.handleTimeInput("end", e.currentTarget.value)}
              onBlur={() => s.finishTimeEdit()}
              onKeyDown={s.handleTimeKeyDown}
              placeholder="0:00"
              class="text-sm text-fg bg-surface-input rounded px-1 py-0 border border-border outline-none focus:border-accent w-[4rem] text-center"
            />
          </Show>
          <Show when={formatDate(s.start()!) === formatDate(s.end()!)}>
            <span class="text-xs text-fg-muted whitespace-nowrap">{formatDuration(s.start()!, s.end()!)}</span>
          </Show>
        </div>
      </Show>
      {/* Date row */}
      <Show when={s.start() && s.end()}>
        <div class={`flex gap-4 text-sm text-fg ${s.isAllDay() ? "ml-0" : "ml-[22px]"}`}>
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
      <div class="ml-[22px] flex items-center gap-3 text-xs text-fg-disabled">
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
              const allDayStart = new Date(Date.UTC(st.getFullYear(), st.getMonth(), st.getDate()));
              const e = s.end() ?? st;
              const allDayEnd = new Date(Date.UTC(e.getFullYear(), e.getMonth(), e.getDate() + 1));

              s.setIsAllDay(true);
              if (editing) {
                s.setEditStart(allDayStart);
                s.setEditEnd(allDayEnd);
                s.scheduleSave({ isAllDay: true, start: allDayStart, end: allDayEnd });
                s.flushSave();
              }
            } else {
              // All-day -> timed: restore saved times or default to 12pm + 1h
              let newStart: Date;
              let newEnd: Date;
              if (s.savedTimedStart && s.savedTimedEnd) {
                newStart = new Date(st);
                newStart.setHours(s.savedTimedStart.getHours(), s.savedTimedStart.getMinutes(), 0, 0);
                newEnd = new Date(st);
                newEnd.setHours(s.savedTimedEnd.getHours(), s.savedTimedEnd.getMinutes(), 0, 0);
              } else {
                newStart = new Date(st);
                newStart.setHours(12, 0, 0, 0);
                newEnd = new Date(st);
                newEnd.setHours(13, 0, 0, 0);
              }

              s.setIsAllDay(false);
              if (editing) {
                s.setEditStart(newStart);
                s.setEditEnd(newEnd);
                s.scheduleSave({ isAllDay: false, start: newStart, end: newEnd });
                s.flushSave();
              } else {
                setDraftStart(newStart);
                setDraftEnd(newEnd);
              }
            }
          }}
          class="inline-flex items-center gap-1.5 cursor-pointer"
        >
          <Switch.Label class="text-xs text-fg-disabled cursor-pointer">All-day</Switch.Label>
          <Switch.Control
            class={`relative w-7 h-4 rounded-full transition-colors duration-200 ${
              s.isAllDay() ? "bg-accent" : "bg-border-light"
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
        <span>Time zone</span>
        <span>Repeat</span>
      </div>
    </div>
  );
}

export function DetailsSection(props: SectionProps) {
  const s = props.state;

  return (
    <div class="px-3 py-2 border-t border-border space-y-2">
      <div class="flex items-center gap-2 text-sm text-fg-disabled">
        <Users size={14} class="shrink-0" />
        <span>Participants</span>
      </div>
      <div class="flex items-center gap-2 text-sm text-fg-disabled">
        <Video size={14} class="shrink-0" />
        <span>Conferencing</span>
      </div>
      <div class="flex items-center gap-2 text-sm">
        <MapPin size={14} class="text-fg-muted shrink-0" />
        <input
          type="text"
          placeholder="Add location"
          aria-label="Location"
          value={s.location()}
          onInput={(e) => s.setLocation(e.currentTarget.value)}
          onBlur={() => { if (s.mode() === "edit") s.flushSave(); }}
          class="flex-1 text-sm text-fg placeholder-fg-disabled bg-transparent outline-none border-none"
        />
      </div>
      <div class="flex items-center gap-2 text-sm text-fg-disabled">
        <FileText size={14} class="shrink-0" />
        <span>Docs and links</span>
      </div>
    </div>
  );
}

export function DescriptionSection(props: SectionProps) {
  const s = props.state;

  return (
    <div class="px-3 py-2 border-t border-border">
      <div class="flex items-start gap-2">
        <AlignLeft size={14} class="text-fg-muted shrink-0 mt-0.5" />
        <div class="flex-1 grid" style={{ "grid-template-columns": "1fr" }}>
          <textarea
            placeholder="Add description"
            aria-label="Description"
            value={s.description()}
            onInput={(e) => s.setDescription(e.currentTarget.value)}
            onBlur={() => { if (s.mode() === "edit") s.flushSave(); }}
            class="text-sm text-fg placeholder-fg-disabled bg-transparent outline-none border-none resize-none overflow-hidden row-start-1 col-start-1"
            rows={2}
            style={{ "grid-area": "1 / 1 / 2 / 2" }}
          />
          <div
            class="invisible whitespace-pre-wrap text-sm row-start-1 col-start-1 overflow-hidden max-h-40"
            style={{ "grid-area": "1 / 1 / 2 / 2" }}
            aria-hidden="true"
          >
            {s.description() + " "}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CalendarSection(props: SectionProps) {
  const s = props.state;

  return (
    <div class="px-3 py-2 border-t border-border space-y-2">
      <Select.Root
        collection={s.calendarCollection()}
        value={s.calendarId() ? [s.calendarId()!] : []}
        onValueChange={(details) => {
          s.setCalId(details.value[0] ?? null);
        }}
        positioning={{ placement: "bottom-start", sameWidth: true }}
      >
        <Select.Control class="flex items-center gap-2">
          <div
            class="w-3 h-3 rounded-full shrink-0"
            style={{ "background-color": s.eventColor() }}
          />
          <Select.Trigger class="flex-1 flex items-center justify-between text-sm text-fg bg-transparent outline-none border-none cursor-pointer">
            <span>
              {(() => {
                const id = s.calendarId();
                if (!id) return "Select calendar";
                const cal = s.allCalendars().find((c) => c.id === id);
                return cal?.name ?? "Select calendar";
              })()}
            </span>
            <ChevronDown size={12} class="text-fg-muted shrink-0" />
          </Select.Trigger>
        </Select.Control>
        <Select.Positioner>
          <Select.Content class="bg-surface border border-border rounded-lg shadow-lg py-1 z-50 max-h-48 overflow-y-auto">
            <For each={s.allCalendars()}>
              {(cal) => (
                <Select.Item
                  item={cal}
                  class="flex items-center gap-2 px-3 py-1.5 text-sm text-fg cursor-pointer hover:bg-surface-hover data-[highlighted]:bg-surface-hover outline-none"
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
      <div class="ml-[20px] text-xs text-fg-disabled">Busy</div>
      <div class="ml-[20px] text-xs text-fg-disabled">Default visibility</div>
    </div>
  );
}

export function RemindersSection() {
  return (
    <div class="px-3 py-2 border-t border-border space-y-1">
      <div class="flex items-center gap-2 text-sm text-fg-disabled">
        <Bell size={14} class="shrink-0" />
        <span>Reminders</span>
      </div>
      <div class="ml-[22px] text-xs text-fg-disabled">30min before</div>
    </div>
  );
}
