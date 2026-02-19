import { Show, For, createSignal, createMemo, createEffect, on, untrack, batch } from "solid-js";
import {
  Clock,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Globe,
  Repeat,
} from "lucide-solid";
import { Switch } from "@ark-ui/solid/switch";
import { Select, createListCollection } from "@ark-ui/solid/select";
import { Combobox } from "@ark-ui/solid/combobox";
import { Popover } from "@ark-ui/solid/popover";
import { RotateCcw } from "lucide-solid";
import { setDraftStart, setDraftEnd } from "../../stores/event-creation";
import { formatTime, formatDuration, formatDate, parseTimeInput } from "../../lib/format-utils";
import { isToday, isSameDay, addDays, formatMonthYearLocale, computeWeeksInMonth } from "../../lib/date-utils";
import { WEEKDAY_LABELS } from "../../constants/sidebar";
import { getAllDayInclusiveEnd } from "../../utils/allDayLayout";
import { selectedEvent } from "../../stores/event-selection";
import { events } from "../../stores/events";
import { CustomRecurrenceDialog } from "./CustomRecurrenceDialog";
import { dayCodeFromDate, ordinal } from "../../utils/recurrence-format";
import { formatRecurrence } from "../../utils/recurrence-format";
import { setCenterDate, visibleStartDate } from "../../stores/calendar-navigation";
import { visibleDaysCount } from "../../stores/view";
import { SYSTEM_TIMEZONE } from "../../constants/calendar";
import type { EventFormState } from "./useEventFormState";

interface SectionProps {
  state: EventFormState;
}

export function TimeSection(props: SectionProps) {
  const s = props.state;
  const isEditable = () => s.mode() === "create" || s.isOrganizer();

  /** Change only the date portion of a datetime, preserving hours/minutes.
   *  All-day events use UTC midnight dates, so we use Date.UTC to avoid
   *  local-time DST shifts landing on the wrong day. */
  function changeDatePortion(which: "start" | "end", dateValue: { year: number; month: number; day: number }) {
    const current = which === "start" ? s.start()! : s.end()!;

    let updated: Date;
    if (s.isAllDay()) {
      // All-day dates are stored as UTC midnight — construct with Date.UTC
      updated = new Date(Date.UTC(dateValue.year, dateValue.month - 1, dateValue.day));
    } else {
      updated = new Date(current);
      updated.setFullYear(dateValue.year, dateValue.month - 1, dateValue.day);
    }

    if (which === "start") {
      const diff = updated.getTime() - s.start()!.getTime();
      const newEnd = s.end() ? new Date(s.end()!.getTime() + diff) : undefined;
      batch(() => {
        s.setStart(updated);
        if (newEnd) s.setEnd(newEnd);
      });
    } else {
      const diff = updated.getTime() - s.end()!.getTime();
      const newStart = updated < s.start()! ? new Date(s.start()!.getTime() + diff) : undefined;
      batch(() => {
        s.setEnd(updated);
        if (newStart) s.setStart(newStart);
      });
    }
    // Scroll grid to show the changed date if it's off-screen
    const visStart = visibleStartDate();
    const visEnd = addDays(visStart, visibleDaysCount() - 1);
    if (updated < visStart || updated > visEnd) {
      setCenterDate(updated);
    }
    if (s.mode() === "edit") s.flushSave();
  }

  return (
    <div class="px-3 py-3 border-t border-border space-y-1.5">
      {/* All-day toggle — organizer only */}
      <Show when={isEditable()}>
        <Switch.Root
          checked={s.isAllDay()}
          onCheckedChange={() => {
            const wasAllDay = s.isAllDay();
            const st = s.start()!;
            const editing = s.mode() === "edit";

            if (!wasAllDay) {
              s.savedTimedStart = new Date(st);
              s.savedTimedEnd = s.end() ? new Date(s.end()!) : null;
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
                s.scheduleSave({ isAllDay: true, start: allDayStart, end: allDayEnd });
                s.flushSave();
              }
            } else {
              const rawEnd = s.end() ?? st;
              const lastDay = new Date(rawEnd);
              lastDay.setDate(lastDay.getDate() - 1);
              if (lastDay < st) lastDay.setTime(st.getTime());
              const isMultiDay = lastDay.toDateString() !== st.toDateString();

              let newStart: Date;
              let newEnd: Date;
              if (s.savedTimedStart && s.savedTimedEnd) {
                newStart = new Date(st);
                newStart.setHours(s.savedTimedStart.getHours(), s.savedTimedStart.getMinutes(), 0, 0);
                newEnd = new Date(isMultiDay ? lastDay : st);
                newEnd.setHours(s.savedTimedEnd.getHours(), s.savedTimedEnd.getMinutes(), 0, 0);
              } else if (isMultiDay) {
                newStart = new Date(st);
                newStart.setHours(9, 0, 0, 0);
                newEnd = new Date(lastDay);
                newEnd.setHours(17, 0, 0, 0);
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
          class="flex items-center gap-2 cursor-pointer rounded px-2 py-2 hover:bg-surface-hover transition-colors"
        >
          <Clock size={14} class="text-fg-muted shrink-0" />
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
      </Show>
      {/* Date/time rows — always two rows (Start / End) regardless of mode */}
      <Show when={s.start() && s.end()}>
        {/* Start row */}
        <div class="flex items-center gap-2 px-2 py-1 text-sm">
          <span class="w-3.5 shrink-0" />
          <span class="w-8 text-xs text-fg-muted shrink-0">Start</span>
          <Show
            when={isEditable()}
            fallback={<span class="flex-1 text-fg">{formatDate(s.start()!, s.timeZone())}</span>}
          >
            <DatePickerTrigger
              date={() => s.start()!}
              rangeStart={() => s.start()!}
              rangeEnd={() => s.isAllDay() ? getAllDayInclusiveEnd(s.end()!) : s.end()!}
              timeZone={() => s.timeZone()}
              onChange={(dv) => changeDatePortion("start", dv)}
            />
          </Show>
          <Show when={!s.isAllDay()}>
            <Show
              when={isEditable()}
              fallback={<span class="text-fg">{formatTime(s.start()!, s.timeZone())}</span>}
            >
              <TimeCombobox
                date={() => s.start()!}
                timeZone={() => s.timeZone()}
                which="start"
                ariaLabel="Start time"
                state={s}
                referenceHour={() => new Date().getHours()}
              />
            </Show>
            {/* Duration hint — same-day timed events only */}
            <Show when={formatDate(s.start()!, s.timeZone()) === formatDate(s.end()!, s.timeZone())}>
              <span class="text-xs text-fg-muted whitespace-nowrap">
                ({formatDuration(s.start()!, s.end()!)})
              </span>
            </Show>
          </Show>
        </div>
        {/* End row */}
        <div class="flex items-center gap-2 px-2 py-1 text-sm">
          <span class="w-3.5 shrink-0" />
          <span class="w-8 text-xs text-fg-muted shrink-0">End</span>
          <Show
            when={isEditable()}
            fallback={
              <span class="flex-1 text-fg">
                {formatDate(s.isAllDay() ? getAllDayInclusiveEnd(s.end()!) : s.end()!, s.timeZone())}
              </span>
            }
          >
            <DatePickerTrigger
              date={() => s.isAllDay() ? getAllDayInclusiveEnd(s.end()!) : s.end()!}
              rangeStart={() => s.start()!}
              rangeEnd={() => s.isAllDay() ? getAllDayInclusiveEnd(s.end()!) : s.end()!}
              timeZone={() => s.timeZone()}
              onChange={(dv) => {
                if (s.isAllDay()) {
                  s.setAllDayEnd(dv);
                } else {
                  changeDatePortion("end", dv);
                }
              }}
            />
          </Show>
          <Show when={!s.isAllDay()}>
            <Show
              when={isEditable()}
              fallback={<span class="text-fg">{formatTime(s.end()!, s.timeZone())}</span>}
            >
              <TimeCombobox
                date={() => s.end()!}
                timeZone={() => s.timeZone()}
                which="end"
                ariaLabel="End time"
                state={s}
                referenceHour={() => s.start()!.getHours()}
                excludeBeforeMinutes={() => s.start()!.getHours() * 60 + s.start()!.getMinutes()}
              />
            </Show>
          </Show>
        </div>
      </Show>
      {/* "Your time" row — shown when event timezone differs from system */}
      <Show when={s.start() && s.end() && !s.isAllDay() && s.timeZone() && s.timeZone() !== SYSTEM_TIMEZONE}>
        <div class="flex items-center gap-2 pl-[74px] text-xs text-fg-disabled">
          <span class="whitespace-nowrap">{formatTime(s.start()!)}</span>
          <ArrowRight size={12} class="shrink-0" />
          <span class="whitespace-nowrap">
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
      {/* Timezone + Repeat — organizer only */}
      <Show when={isEditable()}>
        <TimezoneSelector state={s} />
        <RecurrenceSelector state={s} />
      </Show>
    </div>
  );
}

/** Compact date picker trigger — shows formatted date, opens calendar popover on click */
function DatePickerTrigger(props: {
  date: () => Date;
  rangeStart?: () => Date;
  rangeEnd?: () => Date;
  timeZone: () => string | undefined;
  onChange: (value: { year: number; month: number; day: number }) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [currentMonth, setCurrentMonth] = createSignal(
    new Date(props.date().getFullYear(), props.date().getMonth(), 1)
  );

  const weeks = createMemo(() => computeWeeksInMonth(currentMonth()));

  const isCurrentMonthView = () => {
    const today = new Date();
    return (
      currentMonth().getMonth() === today.getMonth() &&
      currentMonth().getFullYear() === today.getFullYear()
    );
  };

  const resetMonth = () => {
    const today = new Date();
    setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
  };

  const prevMonth = () => {
    const d = new Date(currentMonth());
    d.setMonth(d.getMonth() - 1);
    setCurrentMonth(d);
  };

  const nextMonth = () => {
    const d = new Date(currentMonth());
    d.setMonth(d.getMonth() + 1);
    setCurrentMonth(d);
  };

  const isSameDate = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  /** Check if a date falls within the event range (inclusive, date-only comparison). Hidden for single-day events. */
  const isInRange = (d: Date) => {
    const rs = props.rangeStart?.();
    const re = props.rangeEnd?.();
    if (!rs || !re) return false;
    // Don't show range for single-day events
    if (isSameDate(rs, re)) return false;
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const s = new Date(rs.getFullYear(), rs.getMonth(), rs.getDate()).getTime();
    const e = new Date(re.getFullYear(), re.getMonth(), re.getDate()).getTime();
    return t >= s && t <= e;
  };

  /** Compute range highlight indices for a week row */
  const getRangeStyle = (week: { date: Date }[]) => {
    const indices: number[] = [];
    week.forEach((dayInfo, idx) => {
      if (isInRange(dayInfo.date)) indices.push(idx);
    });
    if (indices.length === 0) return null;
    const first = Math.min(...indices);
    const last = Math.max(...indices);
    return {
      left: `${(first / 7) * 100}%`,
      width: `${((last - first + 1) / 7) * 100}%`,
    };
  };

  return (
    <Popover.Root
      open={open()}
      onOpenChange={(details) => {
        setOpen(details.open);
        if (details.open) {
          setCurrentMonth(new Date(props.date().getFullYear(), props.date().getMonth(), 1));
        }
      }}
      positioning={{ placement: "bottom-start" }}
    >
      <Popover.Trigger
        class="text-sm text-fg hover:text-fg cursor-pointer bg-transparent border-none outline-none px-1 py-0.5 rounded hover:bg-surface-hover transition-colors whitespace-nowrap text-left"
      >
        {formatDate(props.date(), props.timeZone())}
      </Popover.Trigger>
      <Popover.Positioner>
        <Popover.Content class="bg-surface border border-border rounded-lg shadow-lg p-2 w-64 z-50 select-none">
          {/* Quick picks */}
          <div class="flex gap-1 mb-1.5 px-1">
            <button
              class={`text-xs px-2 py-0.5 rounded cursor-pointer transition-colors ${
                isToday(props.date()) ? "bg-surface-hover text-fg font-medium" : "hover:bg-surface-hover text-fg-muted"
              }`}
              onClick={() => {
                const t = new Date();
                props.onChange({ year: t.getFullYear(), month: t.getMonth() + 1, day: t.getDate() });
                setOpen(false);
              }}
            >
              Today
            </button>
            <button
              class={`text-xs px-2 py-0.5 rounded cursor-pointer transition-colors ${
                isSameDay(props.date(), addDays(new Date(), 1)) ? "bg-surface-hover text-fg font-medium" : "hover:bg-surface-hover text-fg-muted"
              }`}
              onClick={() => {
                const t = addDays(new Date(), 1);
                props.onChange({ year: t.getFullYear(), month: t.getMonth() + 1, day: t.getDate() });
                setOpen(false);
              }}
            >
              Tomorrow
            </button>
          </div>
          <div class="border-t border-border mb-2" />
          {/* Month navigation */}
          <div class="flex items-center justify-between mb-2 px-1.5">
            <span class="text-sm font-medium text-fg">
              {formatMonthYearLocale(currentMonth())}
            </span>
            <div class="flex items-center gap-1">
              <Show when={!isCurrentMonthView()}>
                <button onClick={resetMonth} class="p-1 rounded hover:bg-surface-hover text-fg-muted hover:text-fg cursor-pointer" title="Back to current month">
                  <RotateCcw size={14} />
                </button>
              </Show>
              <button onClick={prevMonth} class="p-1 rounded hover:bg-surface-hover text-fg-muted hover:text-fg cursor-pointer">
                <ChevronLeft size={14} />
              </button>
              <button onClick={nextMonth} class="p-1 rounded hover:bg-surface-hover text-fg-muted hover:text-fg cursor-pointer">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
          {/* Weekday headers */}
          <div class="grid grid-cols-7 mb-1">
            <For each={WEEKDAY_LABELS}>
              {(label) => (
                <div class="text-center text-xs text-fg-muted">{label}</div>
              )}
            </For>
          </div>
          {/* Day grid */}
          <div class="flex flex-col gap-1">
            <For each={weeks()}>
              {(week) => {
                const rangeStyle = () => getRangeStyle(week);
                return (
                  <div class="relative py-1">
                    <Show when={rangeStyle()}>
                      {(style) => (
                        <div
                          class="absolute top-0 bottom-0 bg-surface-hover rounded-md"
                          style={style()}
                        />
                      )}
                    </Show>
                    <div class="relative grid grid-cols-7">
                      <For each={week}>
                        {(dayInfo) => {
                          const isSelected = () => isSameDate(dayInfo.date, props.date());
                          return (
                            <button
                              class="h-6 flex items-center justify-center text-xs transition-colors rounded-md"
                              classList={{
                                "bg-fg text-white hover:bg-fg": isSelected(),
                                "text-fg hover:bg-surface-hover": dayInfo.isCurrentMonth && !isSelected(),
                                "text-fg-disabled hover:bg-surface-hover": !dayInfo.isCurrentMonth && !isSelected(),
                              }}
                              onClick={() => {
                                props.onChange({ year: dayInfo.date.getFullYear(), month: dayInfo.date.getMonth() + 1, day: dayInfo.date.getDate() });
                                setOpen(false);
                              }}
                            >
                              {dayInfo.day}
                            </button>
                          );
                        }}
                      </For>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </Popover.Content>
      </Popover.Positioner>
    </Popover.Root>
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
  createEffect(on(displayTime, (time) => {
    if (!untrack(isEditing)) {
      setInputValue(time);
    }
  }));

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
  const city = tz.split("/").pop() ?? "".replace(/_/g, " ");
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
      const cityA = a.value.split("/").pop() ?? "";
      const cityB = b.value.split("/").pop() ?? "";
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
  createEffect(on(displayLabel, (label) => {
    if (!untrack(isEditing)) setInputValue(label);
  }));

  const allTimezones = getTimezoneItems();

  const filtered = createMemo(() => {
    if (!isEditing()) return allTimezones;
    const q = query().toLowerCase().trim();
    if (!q) return allTimezones;
    // Rank: city prefix > label prefix > substring match
    const prefixMatches: typeof allTimezones = [];
    const substringMatches: typeof allTimezones = [];
    for (const tz of allTimezones) {
      const city = tz.value.split("/").pop() ?? "".toLowerCase().replace(/_/g, " ");
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
    let rec = s.recurrence();
    // Instances don't carry the RRULE — resolve from master so Ark UI sees
    // the real value and fires onValueChange when switching to "none".
    if (!rec && isRecurringInstance()) {
      const recurringId = selectedEvent()?.recurringEventId;
      if (recurringId) {
        const master = events().find(e => e.id === recurringId);
        if (master?.recurrence) rec = master.recurrence;
      }
      // If master not found, fall back to generic "repeats" sentinel
      if (!rec) return "repeats";
    }
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
