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
} from "../../stores/event-drag";
import { selectedEventId, deselectEvent } from "../../stores/event-selection";
import { setFocusedEventId } from "./CalendarEvent";
import { stopAutoScroll } from "../../lib/auto-scroll";

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
        if (event.isAllDay) {
          deleteEvent(eventId);
        } else {
          const wrapper = eventWrapper as HTMLElement & { triggerBurn?: () => void };
          wrapper.triggerBurn?.();
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
