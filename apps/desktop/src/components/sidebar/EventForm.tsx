import { onMount, onCleanup, createSignal, createMemo, Show, For, batch } from "solid-js";
import {
  Clock,
  ArrowRight,
  Users,
  Video,
  MapPin,
  FileText,
  AlignLeft,
  Bell,
} from "lucide-solid";
import {
  isCreating,
  draftStart,
  draftEnd,
  setDraftStart,
  setDraftEnd,
  draftTitle,
  setDraftTitle,
  draftCalendarId,
  setDraftCalendarId,
  draftIsAllDay,
  setDraftIsAllDay,
  draftLocation,
  setDraftLocation,
  draftDescription,
  setDraftDescription,
  commitCreation,
  cancelCreation,
  getDraftColor,
  shadowStart,
  setShadowStart,
  shadowEnd,
  setShadowEnd,
} from "../../stores/event-creation";
import { connectedAccounts } from "../../stores/accounts";

function formatTime(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  if (minutes === 0) return `${displayHour} ${period}`;
  return `${displayHour}:${minutes.toString().padStart(2, "0")} ${period}`;
}

function formatDuration(start: Date, end: Date): string {
  const diffMs = end.getTime() - start.getTime();
  const totalMinutes = Math.round(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Convert Date to "H:MM" display string for the text input */
function toTimeText(date: Date): string {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Parse a partial time string to hours and minutes.
 * Rules:
 * - Empty → 0:00 (midnight)
 * - "12:1" → 12:01 (minutes are the literal number, not left-shifted)
 * - "9" → 9:00
 * - "13:5" → 13:05
 * - "25" → clamped to 23
 * Returns null only if the input contains non-numeric/non-colon characters.
 */
function parseTimeInput(value: string): { hours: number; minutes: number } | null {
  const trimmed = value.trim();
  if (trimmed === "") return { hours: 0, minutes: 0 };

  // Allow only digits and one colon
  if (!/^[\d:]*$/.test(trimmed)) return null;

  const parts = trimmed.split(":");
  if (parts.length > 2) return null;

  const hourStr = parts[0];
  const minStr = parts[1] ?? "";

  const hours = hourStr === "" ? 0 : Math.min(parseInt(hourStr, 10) || 0, 23);
  const minutes = minStr === "" ? 0 : Math.min(parseInt(minStr, 10) || 0, 59);

  return { hours, minutes };
}

export function EventForm() {
  let titleInputRef: HTMLInputElement | undefined;
  let formRef: HTMLDivElement | undefined;
  // Remember timed start/end when switching to all-day so we can restore them
  let savedTimedStart: Date | null = null;
  let savedTimedEnd: Date | null = null;
  const [editingTime, setEditingTime] = createSignal<"start" | "end" | null>(null);
  const [startTimeText, setStartTimeText] = createSignal("");
  const [endTimeText, setEndTimeText] = createSignal("");

  function beginTimeEdit(which: "start" | "end"): void {
    // Store shadow position (original time before editing)
    setShadowStart(draftStart() ? new Date(draftStart()!) : null);
    setShadowEnd(draftEnd() ? new Date(draftEnd()!) : null);

    if (which === "start") {
      setStartTimeText(toTimeText(draftStart()!));
    } else {
      setEndTimeText(toTimeText(draftEnd()!));
    }
    setEditingTime(which);
  }

  /** Apply parsed time to the draft, updating the event chip position live */
  function applyTimeLive(which: "start" | "end", value: string): void {
    const parsed = parseTimeInput(value);
    if (!parsed) return;

    const baseDate = which === "start" ? draftStart()! : draftEnd()!;
    const newDate = new Date(baseDate);
    newDate.setHours(parsed.hours, parsed.minutes, 0, 0);

    if (which === "start") {
      setDraftStart(newDate);
      // Auto-adjust end if it's now before or equal to start
      if (draftEnd()! <= newDate) {
        const adjusted = new Date(newDate);
        adjusted.setHours(adjusted.getHours() + 1);
        setDraftEnd(adjusted);
      }
    } else {
      // If end is before start, auto-adjust to start + 1 hour
      if (newDate <= draftStart()!) {
        const adjusted = new Date(draftStart()!);
        adjusted.setHours(adjusted.getHours() + 1);
        setDraftEnd(adjusted);
      } else {
        setDraftEnd(newDate);
      }
    }
  }

  function handleTimeInput(which: "start" | "end", value: string): void {
    if (which === "start") {
      setStartTimeText(value);
    } else {
      setEndTimeText(value);
    }
    applyTimeLive(which, value);
  }

  function finishTimeEdit(): void {
    batch(() => {
      setEditingTime(null);
      setShadowStart(null);
      setShadowEnd(null);
    });
  }

  function revertTimeEdit(): void {
    // Restore original position from shadow before clearing
    const origStart = shadowStart();
    const origEnd = shadowEnd();
    batch(() => {
      if (origStart) setDraftStart(origStart);
      if (origEnd) setDraftEnd(origEnd);
      setEditingTime(null);
      setShadowStart(null);
      setShadowEnd(null);
    });
  }

  function handleTimeKeyDown(which: "start" | "end", e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      finishTimeEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      revertTimeEdit();
    }
  }

  // Auto-focus title input
  onMount(() => {
    // Small delay to ensure DOM is ready after sidebar content switch
    requestAnimationFrame(() => {
      titleInputRef?.focus();
    });
  });

  // Click-outside detection
  onMount(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!isCreating()) return;

      const target = e.target as HTMLElement;

      // Don't handle if click is inside the form
      if (formRef?.contains(target)) return;

      // Don't handle if click is on the event placeholder
      if (target.closest("[data-event-placeholder]")) return;

      // Don't handle if click is inside a DayColumn (starting a new drag)
      // The DayColumn mousedown handler will handle saving + new creation
      if (target.closest("[data-day-column]")) return;

      if (draftTitle().trim()) {
        commitCreation();
      } else {
        cancelCreation();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    onCleanup(() => document.removeEventListener("mousedown", handleClickOutside));
  });

  const handleTitleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (draftTitle().trim()) {
        commitCreation();
      }
    }
    // Escape is handled by CalendarGrid's document-level handler
  };

  // All visible calendars for the selector
  const allCalendars = createMemo(() => {
    return connectedAccounts()
      .flatMap((a) =>
        a.calendars
          .filter((c) => c.visible)
          .map((c) => ({ ...c, accountEmail: a.email }))
      );
  });

  const selectedCalendarName = createMemo(() => {
    const calId = draftCalendarId();
    if (!calId) return "Calendar";
    const cal = allCalendars().find((c) => c.id === calId);
    return cal?.name ?? "Calendar";
  });

  return (
    <div ref={formRef} class="h-full flex flex-col overflow-hidden" data-event-form>
      <div class="flex-1 overflow-y-auto scrollbar-hidden">
        {/* Title input */}
        <div class="px-3 pt-3 pb-2">
          <input
            ref={titleInputRef}
            type="text"
            placeholder="Title"
            value={draftTitle()}
            onInput={(e) => setDraftTitle(e.currentTarget.value)}
            onKeyDown={handleTitleKeyDown}
            class="w-full text-lg font-medium text-fg placeholder-fg-disabled bg-transparent outline-none border-none"
          />
        </div>

        {/* Time section */}
        <div class="px-3 py-2 border-t border-border space-y-1.5">
          {/* Start time + End time on one row (hidden for all-day) */}
          <Show when={draftStart() && draftEnd() && !draftIsAllDay()}>
            <div class="flex items-center gap-2 text-sm text-fg">
              <Clock size={14} class="text-fg-muted shrink-0" />
              {/* Start time: click-to-edit with live updates */}
              <Show
                when={editingTime() === "start"}
                fallback={
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="Start time"
                    class="whitespace-nowrap cursor-pointer hover:bg-surface-hover rounded px-0.5 -mx-0.5"
                    onClick={() => beginTimeEdit("start")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        beginTimeEdit("start");
                      }
                    }}
                  >
                    {formatTime(draftStart()!)}
                  </span>
                }
              >
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label="Start time"
                  value={startTimeText()}
                  ref={(el) => requestAnimationFrame(() => { el.focus(); el.select(); })}
                  onInput={(e) => handleTimeInput("start", e.currentTarget.value)}
                  onBlur={() => finishTimeEdit()}
                  onKeyDown={(e) => handleTimeKeyDown("start", e)}
                  placeholder="0:00"
                  class="text-sm text-fg bg-surface-input rounded px-1 py-0 border border-border outline-none focus:border-accent w-[4rem] text-center"
                />
              </Show>
              <ArrowRight size={14} class="text-fg-muted shrink-0" />
              {/* End time: click-to-edit with live updates */}
              <Show
                when={editingTime() === "end"}
                fallback={
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="End time"
                    class="whitespace-nowrap cursor-pointer hover:bg-surface-hover rounded px-0.5 -mx-0.5"
                    onClick={() => beginTimeEdit("end")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        beginTimeEdit("end");
                      }
                    }}
                  >
                    {formatTime(draftEnd()!)}
                  </span>
                }
              >
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label="End time"
                  value={endTimeText()}
                  ref={(el) => requestAnimationFrame(() => { el.focus(); el.select(); })}
                  onInput={(e) => handleTimeInput("end", e.currentTarget.value)}
                  onBlur={() => finishTimeEdit()}
                  onKeyDown={(e) => handleTimeKeyDown("end", e)}
                  placeholder="0:00"
                  class="text-sm text-fg bg-surface-input rounded px-1 py-0 border border-border outline-none focus:border-accent w-[4rem] text-center"
                />
              </Show>
              <Show when={formatDate(draftStart()!) === formatDate(draftEnd()!)}>
                <span class="text-xs text-fg-muted whitespace-nowrap">{formatDuration(draftStart()!, draftEnd()!)}</span>
              </Show>
            </div>
          </Show>
          {/* Date row */}
          <Show when={draftStart() && draftEnd()}>
            <div class={`flex gap-4 text-sm text-fg ${draftIsAllDay() ? "ml-0" : "ml-[22px]"}`}>
              <Show when={draftIsAllDay()}>
                <Clock size={14} class="text-fg-muted shrink-0 mt-0.5" />
              </Show>
              <span>{formatDate(draftStart()!)}</span>
              <Show when={formatDate(draftStart()!) !== formatDate(draftEnd()!)}>
                <span>{formatDate(draftEnd()!)}</span>
              </Show>
            </div>
          </Show>
          {/* All-day toggle + stubs */}
          <div class="ml-[22px] flex items-center gap-3 text-xs text-fg-disabled">
            <button
              role="switch"
              aria-checked={draftIsAllDay()}
              aria-label="All day"
              class="inline-flex items-center gap-1.5 cursor-pointer"
              onClick={() => {
                const wasAllDay = draftIsAllDay();
                setDraftIsAllDay(!wasAllDay);
                if (!wasAllDay) {
                  // Switching timed → all-day: save current times for later restore
                  savedTimedStart = draftStart() ? new Date(draftStart()!) : null;
                  savedTimedEnd = draftEnd() ? new Date(draftEnd()!) : null;
                } else {
                  // Switching all-day → timed: restore saved times (or fall back to 9–10 AM)
                  const start = draftStart();
                  if (start && savedTimedStart && savedTimedEnd) {
                    const newStart = new Date(start);
                    newStart.setHours(savedTimedStart.getHours(), savedTimedStart.getMinutes(), 0, 0);
                    const newEnd = new Date(start);
                    newEnd.setHours(savedTimedEnd.getHours(), savedTimedEnd.getMinutes(), 0, 0);
                    setDraftStart(newStart);
                    setDraftEnd(newEnd);
                  } else if (start) {
                    const newStart = new Date(start);
                    newStart.setHours(9, 0, 0, 0);
                    const newEnd = new Date(start);
                    newEnd.setHours(10, 0, 0, 0);
                    setDraftStart(newStart);
                    setDraftEnd(newEnd);
                  }
                }
              }}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.click();
                }
              }}
            >
              <span>All-day</span>
              <div
                class={`relative w-7 h-4 rounded-full transition-colors duration-200 ${
                  draftIsAllDay() ? "bg-accent" : "bg-border-light"
                }`}
              >
                <div
                  class={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform duration-200 ${
                    draftIsAllDay() ? "translate-x-3" : "translate-x-0"
                  }`}
                />
              </div>
            </button>
            <span>Time zone</span>
            <span>Repeat</span>
          </div>
        </div>

        {/* Participants, Conferencing, Location, Docs */}
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
              value={draftLocation()}
              onInput={(e) => setDraftLocation(e.currentTarget.value)}
              class="flex-1 text-sm text-fg placeholder-fg-disabled bg-transparent outline-none border-none"
            />
          </div>
          <div class="flex items-center gap-2 text-sm text-fg-disabled">
            <FileText size={14} class="shrink-0" />
            <span>Docs and links</span>
          </div>
        </div>

        {/* Description */}
        <div class="px-3 py-2 border-t border-border">
          <div class="flex items-start gap-2">
            <AlignLeft size={14} class="text-fg-muted shrink-0 mt-0.5" />
            <div class="flex-1 grid" style={{ "grid-template-columns": "1fr" }}>
              <textarea
                placeholder="Add description"
                aria-label="Description"
                value={draftDescription()}
                onInput={(e) => setDraftDescription(e.currentTarget.value)}
                class="text-sm text-fg placeholder-fg-disabled bg-transparent outline-none border-none resize-none overflow-hidden row-start-1 col-start-1"
                rows={2}
                style={{ "grid-area": "1 / 1 / 2 / 2" }}
              />
              <div
                class="invisible whitespace-pre-wrap text-sm row-start-1 col-start-1 overflow-hidden max-h-40"
                style={{ "grid-area": "1 / 1 / 2 / 2" }}
                aria-hidden="true"
              >
                {draftDescription() + " "}
              </div>
            </div>
          </div>
        </div>

        {/* Calendar selector + status */}
        <div class="px-3 py-2 border-t border-border space-y-2">
          <div class="flex items-center gap-2">
            <div
              class="w-3 h-3 rounded-full shrink-0"
              style={{ "background-color": getDraftColor() }}
            />
            <select
              value={draftCalendarId() ?? ""}
              onChange={(e) => setDraftCalendarId(e.currentTarget.value || null)}
              class="flex-1 text-sm text-fg bg-transparent outline-none border-none cursor-pointer appearance-none"
            >
              <For each={allCalendars()}>
                {(cal) => (
                  <option value={cal.id}>
                    {cal.name}
                  </option>
                )}
              </For>
            </select>
          </div>
          <div class="ml-[20px] text-xs text-fg-disabled">Busy</div>
          <div class="ml-[20px] text-xs text-fg-disabled">Default visibility</div>
        </div>

        {/* Reminders */}
        <div class="px-3 py-2 border-t border-border space-y-1">
          <div class="flex items-center gap-2 text-sm text-fg-disabled">
            <Bell size={14} class="shrink-0" />
            <span>Reminders</span>
          </div>
          <div class="ml-[22px] text-xs text-fg-disabled">30min before</div>
        </div>
      </div>
    </div>
  );
}
