import { createSignal, createEffect, createMemo, onCleanup, For } from "solid-js";
import { flashDate } from "./CalendarGrid";
import { CalendarEvent } from "./CalendarEvent";
import { EventPlaceholder } from "./EventPlaceholder";
import { events } from "../../stores/events";
import { connectedAccounts } from "../../stores/accounts";
import { calculateEventLayouts } from "../../utils/eventLayout";
import { TOTAL_GRID_HEIGHT_PX, HOUR_HEIGHT_PX, SNAP_MINUTES } from "../../constants/calendar";
import { startCreation, isDragging, isCreating, draftTitle, commitCreation, cancelCreation, finishDrag, snapMinutes } from "../../stores/event-creation";
import { deselectEvent, selectedEventId } from "../../stores/event-selection";

interface DayColumnProps {
  date: Date;
}

/** Exported so CalendarGrid can read the drag origin for document-level mousemove */
export let dragColumnDate: Date | null = null;
export let dragOriginMinutes: number | null = null;

export function DayColumn(props: DayColumnProps) {
  // Use a counter to force re-mount of flash element, restarting CSS animation
  const [flashKey, setFlashKey] = createSignal(0);
  const [showFlash, setShowFlash] = createSignal(false);

  const isSameDay = (date1: Date, date2: Date): boolean => {
    return (
      date1.getDate() === date2.getDate() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getFullYear() === date2.getFullYear()
    );
  };

  // Flash effect when this day is selected from mini-calendar
  let flashTimeout: number | undefined;
  createEffect(() => {
    const flash = flashDate();

    // Ignore null - only react to explicit flash requests
    // This prevents canceling ongoing animations when flashDate is cleared
    if (!flash) return;

    const shouldFlash = isSameDay(flash, props.date);

    // Clear any existing timeout when flashDate changes
    if (flashTimeout) {
      clearTimeout(flashTimeout);
      flashTimeout = undefined;
    }

    if (shouldFlash) {
      // Increment key to force re-mount and restart CSS animation
      setFlashKey((k) => k + 1);
      setShowFlash(true);
      flashTimeout = window.setTimeout(() => {
        setShowFlash(false);
      }, 2000);
    } else {
      // A different date was flashed, cancel our flash
      setShowFlash(false);
    }
  });
  onCleanup(() => {
    if (flashTimeout) clearTimeout(flashTimeout);
  });

  const isWeekend = () => {
    const day = props.date.getDay();
    return day === 0 || day === 6;
  };

  // Get visible calendar IDs
  const visibleCalendarIds = () => {
    return new Set(
      connectedAccounts()
        .flatMap((a) => a.calendars)
        .filter((c) => c.visible)
        .map((c) => c.id)
    );
  };

  // Filter events for this day: must overlap this day, from a visible calendar, and not all-day
  // Multi-day timed events appear on every day they span
  const dayEvents = createMemo(() => {
    const visible = visibleCalendarIds();
    const allEvents = events();

    const colStart = new Date(props.date);
    colStart.setHours(0, 0, 0, 0);
    const colEnd = new Date(colStart);
    colEnd.setDate(colEnd.getDate() + 1);

    return allEvents.filter(
      (event) =>
        event.start < colEnd &&
        event.end > colStart &&
        visible.has(event.calendarId) &&
        !event.isAllDay
    );
  });

  // Calculate layout info for overlapping events
  const eventLayouts = createMemo(() => calculateEventLayouts(dayEvents()));

  /** Pixels the mouse must move before we treat it as a drag */
  const DRAG_THRESHOLD = 4;

  /** Cleanup function to tear down pending drag listeners */
  let cleanupPendingDrag: (() => void) | null = null;

  const handleMouseDown = (e: MouseEvent) => {
    // Only left button
    if (e.button !== 0) return;

    const target = e.target as HTMLElement;
    if (target.closest("[data-event-id]")) {
      // Clicking on an existing event — cancel any active creation
      // (selection is handled by CalendarEvent's onClick)
      if (isCreating()) {
        if (draftTitle().trim()) {
          commitCreation();
        } else {
          cancelCreation();
        }
      }
      return;
    }

    // Clicking empty space — deselect any selected event
    if (selectedEventId()) {
      deselectEvent();
    }

    // Commit/cancel any active creation first
    if (isCreating()) {
      if (draftTitle().trim()) {
        commitCreation();
      } else {
        cancelCreation();
      }
    }

    // Snapshot date now — props.date is a reactive getter that may change after cancelCreation
    const date = new Date(props.date);

    // Record press position; don't start creation until drag threshold is exceeded
    const startY = e.clientY;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const totalMinutes = (mouseY / HOUR_HEIGHT_PX) * 60;
    const snapped = snapMinutes(Math.max(0, Math.min(totalMinutes, 24 * 60 - SNAP_MINUTES)));
    let started = false;

    const onMove = (me: MouseEvent) => {
      if (!started && Math.abs(me.clientY - startY) >= DRAG_THRESHOLD) {
        started = true;
        dragColumnDate = date;
        dragOriginMinutes = snapped;
        startCreation(date, snapped);
      }
    };

    const cleanup = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", cleanup);
      cleanupPendingDrag = null;
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", cleanup);
    cleanupPendingDrag = cleanup;
    e.preventDefault();
  };

  const handleDblClick = (e: MouseEvent) => {
    // Cancel any pending drag detection from the second mousedown
    if (cleanupPendingDrag) {
      cleanupPendingDrag();
    }
    // Only left button
    if (e.button !== 0) return;

    const target = e.target as HTMLElement;
    if (target.closest("[data-event-id]")) return;

    // Calculate snapped time from mouse position
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const totalMinutes = (mouseY / HOUR_HEIGHT_PX) * 60;
    const snapped = snapMinutes(Math.max(0, Math.min(totalMinutes, 24 * 60 - SNAP_MINUTES)));

    // Store drag origin for CalendarGrid's document-level handlers
    dragColumnDate = new Date(props.date);
    dragOriginMinutes = snapped;

    startCreation(props.date, snapped);
    finishDrag(); // Don't let CalendarGrid's global mousemove treat this as a drag

    e.preventDefault();
  };

  return (
    <div
      data-day-column
      class="relative [contain:strict]"
      style={{ height: `${TOTAL_GRID_HEIGHT_PX}px` }}
      classList={{
        "bg-surface-weekend": isWeekend(),
      }}
      onMouseDown={handleMouseDown}
      onDblClick={handleDblClick}
    >
      {/* Hour grid lines rendered via CSS background for performance */}
      {/* Start at 48px (1 hour) to avoid line at y=0, lines appear at 48, 96, 144... (1AM, 2AM, 3AM...) */}
      <div
        class="absolute left-0 right-0 bottom-0 pointer-events-none"
        style={{
          top: "var(--grid-hour-height)",
          "background-image": "linear-gradient(to bottom, var(--color-border) 1px, transparent 1px)",
          "background-size": "100% var(--grid-hour-height)",
        }}
      />

      {/* Calendar events */}
      <For each={dayEvents()}>
        {(event) => (
          <CalendarEvent event={event} layout={eventLayouts().get(event.id)} columnDate={props.date} />
        )}
      </For>

      {/* Event creation placeholder */}
      <EventPlaceholder date={props.date} />

      {/* Flash highlight overlay - For with key forces re-mount to restart CSS animation */}
      <For each={showFlash() ? [flashKey()] : []}>
        {() => (
          <div class="absolute inset-0 bg-accent pointer-events-none animate-flash-highlight" />
        )}
      </For>
    </div>
  );
}
