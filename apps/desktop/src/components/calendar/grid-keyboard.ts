import { onCleanup } from "solid-js";
import { events, setEvents } from "../../stores/events";
import { deleteEvent } from "../../stores/event-deletion";
import {
  isDragging,
  isCreating,
  draftTitle,
  cancelCreation,
} from "../../stores/event-creation";
import {
  isMoveDragging, moveDrag, cancelMoveDrag,
  isResizeDragging, resizeDrag, cancelResizeDrag,
  isUnfolding, unfoldDrag, cancelUnfoldDrag,
  isAllDayMoveDragging, allDayMoveDrag, cancelAllDayMoveDrag,
} from "../../stores/event-drag";
import { selectedEventId, deselectEvent } from "../../stores/event-selection";
import { setFocusedEventId } from "./CalendarEvent";
import { stopAutoScroll } from "../../lib/auto-scroll";
import {
  visibleStartDate,
  setCenterDate,
  setFlashDate,
} from "../../stores/calendar-navigation";
import { currentView, visibleDaysCount } from "../../stores/view";
import { addDays, getSundayOfWeek } from "../../lib/date-utils";

/** Check if focus is in an editable element (input, textarea, contenteditable) */
function isEditing(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function setupKeyboardHandlers() {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // Cancel move drag on Escape
      if (isMoveDragging()) {
        stopAutoScroll();
        document.body.classList.remove("dragging");
        const drag = moveDrag();
        if (drag) {
          setEvents((prev) =>
            prev.map((ev) =>
              ev.id === drag.event.id
                ? { ...ev, start: drag.originalStart, end: drag.originalEnd }
                : ev
            )
          );
        }
        cancelMoveDrag();
        e.preventDefault();
        return;
      }
      // Cancel resize drag on Escape
      if (isResizeDragging()) {
        stopAutoScroll();
        document.body.classList.remove("dragging");
        const drag = resizeDrag();
        if (drag) {
          setEvents((prev) =>
            prev.map((ev) =>
              ev.id === drag.event.id
                ? { ...ev, start: drag.originalStart, end: drag.originalEnd }
                : ev
            )
          );
        }
        cancelResizeDrag();
        e.preventDefault();
        return;
      }
      // Cancel unfold drag on Escape
      if (isUnfolding()) {
        stopAutoScroll();
        document.body.classList.remove("dragging");
        const drag = unfoldDrag();
        if (drag) {
          setEvents((prev) =>
            prev.map((ev) =>
              ev.id === drag.event.id
                ? { ...ev, start: drag.originalStart, end: drag.originalEnd }
                : ev
            )
          );
        }
        cancelUnfoldDrag();
        e.preventDefault();
        return;
      }
      // Cancel all-day move drag on Escape
      if (isAllDayMoveDragging()) {
        stopAutoScroll();
        document.body.classList.remove("dragging");
        const drag = allDayMoveDrag();
        if (drag) {
          setEvents((prev) =>
            prev.map((ev) =>
              ev.id === drag.event.id
                ? { ...ev, start: drag.originalStart, end: drag.originalEnd }
                : ev
            )
          );
        }
        cancelAllDayMoveDrag();
        e.preventDefault();
        return;
      }
      // Cancel event creation on Escape
      if (isDragging() || isCreating()) {
        if (isDragging() || !draftTitle().trim()) {
          stopAutoScroll();
          cancelCreation();
          e.preventDefault();
          return;
        }
      }
      // Deselect event on Escape
      if (selectedEventId()) {
        deselectEvent();
        e.preventDefault();
        return;
      }
      (document.activeElement as HTMLElement | null)?.blur();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      const activeEl = document.activeElement as HTMLElement | null;
      const eventWrapper = activeEl?.closest(
        "[data-event-id]",
      ) as HTMLElement | null;
      if (eventWrapper) {
        e.preventDefault();
        const eventId = eventWrapper.dataset.eventId;
        if (!eventId) return;
        const event = events().find((ev) => ev.id === eventId);
        if (!event) return;
        if (event.isReadOnly) return;
        // Use burn animation if available (timed event chips in day columns),
        // otherwise delete directly (all-day chips, multi-day timed in all-day row)
        const wrapper = eventWrapper as HTMLElement & { triggerBurn?: () => void };
        if (wrapper.triggerBurn) {
          wrapper.triggerBurn();
        } else {
          deleteEvent(eventId);
        }
      }
    } else if (!isEditing() && !isCreating() && !isDragging() && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // Navigation keyboard shortcuts — only when not typing in an input
      switch (e.key) {
        case "t":
        case "T": {
          // Go to today
          const today = new Date();
          const targetDate = visibleDaysCount() >= 7 ? getSundayOfWeek(today) : today;
          setCenterDate(targetDate);
          setFlashDate(today);
          setTimeout(() => setFlashDate(null), 50);
          e.preventDefault();
          break;
        }
        case "j":
        case "ArrowRight": {
          // Navigate forward
          if (e.shiftKey) break; // Don't interfere with text selection
          const date = visibleStartDate();
          if (currentView() === "Month") {
            const nextMonth = new Date(date);
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            setCenterDate(nextMonth);
          } else {
            setCenterDate(addDays(date, visibleDaysCount()));
          }
          e.preventDefault();
          break;
        }
        case "k":
        case "ArrowLeft": {
          // Navigate backward
          if (e.shiftKey) break;
          const date = visibleStartDate();
          if (currentView() === "Month") {
            const prevMonth = new Date(date);
            prevMonth.setMonth(prevMonth.getMonth() - 1);
            setCenterDate(prevMonth);
          } else {
            setCenterDate(addDays(date, -visibleDaysCount()));
          }
          e.preventDefault();
          break;
        }
      }
    }
  };
  document.addEventListener("keydown", handleKeyDown);
  onCleanup(() => document.removeEventListener("keydown", handleKeyDown));

  // Clear event focus when clicking outside any event chip
  const handleFocusClick = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest("[data-event-id]")) {
      setFocusedEventId(null);
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest("[data-event-id]")) {
        active.blur();
      }
    }
  };
  document.addEventListener("mousedown", handleFocusClick);
  onCleanup(() => document.removeEventListener("mousedown", handleFocusClick));
}
