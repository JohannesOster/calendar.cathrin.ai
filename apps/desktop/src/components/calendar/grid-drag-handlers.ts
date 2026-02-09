import type { Accessor } from "solid-js";
import { addDays } from "../../lib/date-utils";
import {
  HOUR_HEIGHT_PX,
  SNAP_MINUTES,
  CENTER_OFFSET,
  MONTH_LABEL_HEIGHT,
  HEADER_HEIGHT,
} from "../../constants/calendar";
import { anchorDate } from "../../stores/calendar-navigation";
import { events, setEvents, updateEvent } from "../../stores/events";
import {
  isDragging,
  updateDrag,
  finishDrag,
  snapMinutes,
} from "../../stores/event-creation";
import {
  isMoveDragging, moveDrag, finishMoveDrag,
  isResizeDragging, resizeDrag, finishResizeDrag,
  isUnfolding, unfoldDrag, finishUnfoldDrag,
} from "../../stores/event-drag";
import { dragColumnDate, dragOriginMinutes } from "./DayColumn";
import {
  startAutoScroll,
  updateAutoScrollCursor,
  stopAutoScroll,
} from "../../lib/auto-scroll";
import { getTimeColWidth } from "./grid-layout";

interface DragHandlersDeps {
  getScrollContainerRef: () => HTMLDivElement | undefined;
  colWidth: Accessor<number>;
  snapEnabled: Accessor<boolean>;
  setSnapEnabled: (v: boolean) => void;
  visualAllDayHeight: Accessor<number>;
  handleScroll: () => void;
}

export function createDragHandlers(deps: DragHandlersDeps) {
  let lastDragClientY = 0;
  let lastDragClientX = 0;

  const getDateFromClientX = (clientX: number): Date | null => {
    const gridArea = deps.getScrollContainerRef();
    if (!gridArea) return null;

    const gridRect = gridArea.getBoundingClientRect();
    const virtualX = clientX - gridRect.left + gridArea.scrollLeft;
    const currentColWidth = deps.colWidth();
    if (currentColWidth <= 0) return null;

    const dayIndex = Math.floor((virtualX - CENTER_OFFSET) / currentColWidth);
    return addDays(anchorDate(), dayIndex);
  };

  const getMinutesFromClientY = (clientY: number): number => {
    const gridArea = deps.getScrollContainerRef();
    if (!gridArea) return 0;

    const gridRect = gridArea.getBoundingClientRect();
    const stickyHeaderHeight = MONTH_LABEL_HEIGHT + HEADER_HEIGHT + deps.visualAllDayHeight();
    const mouseY = clientY - gridRect.top - stickyHeaderHeight + gridArea.scrollTop;
    const totalMinutes = (mouseY / HOUR_HEIGHT_PX) * 60;
    return snapMinutes(Math.max(0, Math.min(totalMinutes, 24 * 60 - SNAP_MINUTES)));
  };

  const recalcDragPosition = () => {
    if (!isDragging() || dragColumnDate === null || dragOriginMinutes === null) return;
    const gridArea = deps.getScrollContainerRef();
    if (!gridArea) return;

    const gridRect = gridArea.getBoundingClientRect();
    const stickyHeaderHeight = MONTH_LABEL_HEIGHT + HEADER_HEIGHT + deps.visualAllDayHeight();

    const mouseY = lastDragClientY - gridRect.top - stickyHeaderHeight + gridArea.scrollTop;
    const totalMinutes = (mouseY / HOUR_HEIGHT_PX) * 60;
    const snapped = snapMinutes(Math.max(0, Math.min(totalMinutes, 24 * 60 - SNAP_MINUTES)));

    const currentDate = getDateFromClientX(lastDragClientX) ?? dragColumnDate;
    updateDrag(dragOriginMinutes, snapped, dragColumnDate, currentDate);
  };

  const recalcMovePosition = () => {
    const drag = moveDrag();
    if (!drag) return;

    const cursorMinutes = getMinutesFromClientY(lastDragClientY);
    const newStartMinutes = Math.max(0, cursorMinutes - drag.cursorOffsetMinutes);

    const durationMs = drag.originalEnd.getTime() - drag.originalStart.getTime();
    const targetDate = getDateFromClientX(lastDragClientX);
    if (!targetDate) return;

    const newStart = new Date(targetDate);
    newStart.setHours(0, 0, 0, 0);
    newStart.setMinutes(newStartMinutes);

    let newEnd = new Date(newStart.getTime() + durationMs);

    const dayMidnight = new Date(newStart);
    dayMidnight.setHours(24, 0, 0, 0);
    if (newEnd.getTime() > dayMidnight.getTime()) {
      const durationMinutes = Math.round(durationMs / 60000);
      const clampedStartMinutes = Math.max(0, 24 * 60 - durationMinutes);
      newStart.setHours(0, 0, 0, 0);
      newStart.setMinutes(clampedStartMinutes);
      newEnd = new Date(newStart.getTime() + durationMs);
    }

    setEvents((prev) =>
      prev.map((e) =>
        e.id === drag.event.id
          ? { ...e, start: newStart, end: newEnd }
          : e
      )
    );
  };

  const recalcResizePosition = () => {
    const drag = resizeDrag();
    if (!drag) return;

    const cursorMinutes = getMinutesFromClientY(lastDragClientY);
    const cursorDate = getDateFromClientX(lastDragClientX);

    const anchorDay = new Date(drag.originalStart);
    anchorDay.setHours(0, 0, 0, 0);
    const anchorMinutes = drag.originalStart.getHours() * 60 + drag.originalStart.getMinutes();

    const anchorDateTime = new Date(anchorDay);
    anchorDateTime.setMinutes(anchorMinutes);

    const targetDay = cursorDate ? new Date(cursorDate) : new Date(anchorDay);
    targetDay.setHours(0, 0, 0, 0);
    const cursorDateTime = new Date(targetDay);
    cursorDateTime.setMinutes(cursorMinutes);

    let newStart: Date;
    let newEnd: Date;

    if (cursorDateTime.getTime() >= anchorDateTime.getTime()) {
      newStart = anchorDateTime;
      newEnd = cursorDateTime;
      if (newEnd.getTime() - newStart.getTime() < SNAP_MINUTES * 60000) {
        newEnd = new Date(newStart.getTime() + SNAP_MINUTES * 60000);
      }
    } else {
      newStart = cursorDateTime;
      newEnd = anchorDateTime;
      if (newEnd.getTime() - newStart.getTime() < SNAP_MINUTES * 60000) {
        newStart = new Date(newEnd.getTime() - SNAP_MINUTES * 60000);
      }
    }

    setEvents((prev) =>
      prev.map((e) =>
        e.id === drag.event.id
          ? { ...e, start: newStart, end: newEnd }
          : e
      )
    );
  };

  const recalcUnfoldPosition = () => {
    const drag = unfoldDrag();
    if (!drag) return;

    const cursorMinutes = getMinutesFromClientY(lastDragClientY);
    const cursorDate = getDateFromClientX(lastDragClientX);

    const anchorTime = drag.edge === "end" ? drag.originalStart : drag.originalEnd;
    const anchorDay = new Date(anchorTime);
    anchorDay.setHours(0, 0, 0, 0);
    const anchorMinutes = anchorTime.getHours() * 60 + anchorTime.getMinutes();

    const anchorDateTime = new Date(anchorDay);
    anchorDateTime.setMinutes(anchorMinutes);

    const targetDay = cursorDate ? new Date(cursorDate) : new Date(anchorDay);
    targetDay.setHours(0, 0, 0, 0);
    const cursorDateTime = new Date(targetDay);
    cursorDateTime.setMinutes(cursorMinutes);

    let newStart: Date;
    let newEnd: Date;

    if (cursorDateTime.getTime() >= anchorDateTime.getTime()) {
      newStart = anchorDateTime;
      newEnd = cursorDateTime;
      if (newEnd.getTime() - newStart.getTime() < SNAP_MINUTES * 60000) {
        newEnd = new Date(newStart.getTime() + SNAP_MINUTES * 60000);
      }
    } else {
      newStart = cursorDateTime;
      newEnd = anchorDateTime;
      if (newEnd.getTime() - newStart.getTime() < SNAP_MINUTES * 60000) {
        newStart = new Date(newEnd.getTime() - SNAP_MINUTES * 60000);
      }
    }

    setEvents((prev) =>
      prev.map((e) =>
        e.id === drag.event.id
          ? { ...e, start: newStart, end: newEnd }
          : e
      )
    );
  };

  const handleDragPointerMove = (e: PointerEvent) => {
    lastDragClientY = e.clientY;
    lastDragClientX = e.clientX;

    const ref = deps.getScrollContainerRef();

    // --- Move drag ---
    if (isMoveDragging()) {
      if (!ref) return;

      if (!document.body.classList.contains("dragging")) {
        document.body.classList.add("dragging");
      }

      if (deps.snapEnabled()) {
        ref.style.scrollSnapType = "none";
        deps.setSnapEnabled(false);
      }

      const timeColWidth = getTimeColWidth();
      const stickyHeaderHeight = MONTH_LABEL_HEIGHT + HEADER_HEIGHT + deps.visualAllDayHeight();
      startAutoScroll(ref, stickyHeaderHeight, recalcMovePosition, timeColWidth, deps.colWidth());
      updateAutoScrollCursor(e.clientY, e.clientX);

      recalcMovePosition();
      e.preventDefault();
      return;
    }

    // --- Resize drag ---
    if (isResizeDragging()) {
      if (!ref) return;

      if (!document.body.classList.contains("dragging")) {
        document.body.classList.add("dragging");
      }

      if (deps.snapEnabled()) {
        ref.style.scrollSnapType = "none";
        deps.setSnapEnabled(false);
      }

      const timeColWidth = getTimeColWidth();
      const stickyHeaderHeight = MONTH_LABEL_HEIGHT + HEADER_HEIGHT + deps.visualAllDayHeight();
      startAutoScroll(ref, stickyHeaderHeight, recalcResizePosition, timeColWidth, deps.colWidth());
      updateAutoScrollCursor(e.clientY, e.clientX);

      recalcResizePosition();
      e.preventDefault();
      return;
    }

    // --- Unfold drag ---
    if (isUnfolding()) {
      if (!ref) return;

      if (!document.body.classList.contains("dragging")) {
        document.body.classList.add("dragging");
      }

      if (deps.snapEnabled()) {
        ref.style.scrollSnapType = "none";
        deps.setSnapEnabled(false);
      }

      const timeColWidth = getTimeColWidth();
      const stickyHeaderHeight = MONTH_LABEL_HEIGHT + HEADER_HEIGHT + deps.visualAllDayHeight();
      startAutoScroll(ref, stickyHeaderHeight, recalcUnfoldPosition, timeColWidth, deps.colWidth());
      updateAutoScrollCursor(e.clientY, e.clientX);

      recalcUnfoldPosition();
      e.preventDefault();
      return;
    }

    // --- Create drag ---
    if (!isDragging() || dragColumnDate === null || dragOriginMinutes === null) return;
    if (!ref) return;

    if (deps.snapEnabled()) {
      ref.style.scrollSnapType = "none";
      deps.setSnapEnabled(false);
    }

    const stickyHeaderHeight = MONTH_LABEL_HEIGHT + HEADER_HEIGHT + deps.visualAllDayHeight();
    const timeColWidth = getTimeColWidth();
    startAutoScroll(ref, stickyHeaderHeight, recalcDragPosition, timeColWidth, deps.colWidth());
    updateAutoScrollCursor(e.clientY, e.clientX);

    recalcDragPosition();
    e.preventDefault();
  };

  const settleSnapAfterDrag = () => {
    const ref = deps.getScrollContainerRef();
    if (!ref) return;
    const currentScrollLeft = ref.scrollLeft;
    const timeColWidth = getTimeColWidth();
    const currentColWidth = deps.colWidth();
    const visualLeftEdge = currentScrollLeft + timeColWidth;
    const dayIndex = Math.round((visualLeftEdge - CENTER_OFFSET) / currentColWidth);
    const snappedScrollLeft = CENTER_OFFSET + dayIndex * currentColWidth - timeColWidth;
    ref.scrollLeft = snappedScrollLeft;
    deps.handleScroll();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const ref2 = deps.getScrollContainerRef();
        if (ref2) {
          ref2.style.scrollSnapType = "";
        }
        deps.setSnapEnabled(true);
      });
    });
  };

  const handleDragPointerUp = () => {
    // --- Move drag ---
    if (isMoveDragging()) {
      stopAutoScroll();
      document.body.classList.remove("dragging");

      const drag = finishMoveDrag();
      if (drag) {
        const event = events().find((e) => e.id === drag.event.id);
        const changed = event &&
          (event.start.getTime() !== drag.originalStart.getTime() ||
           event.end.getTime() !== drag.originalEnd.getTime());
        if (event && changed) {
          updateEvent(drag.event.id, { start: event.start, end: event.end });
        }
      }

      settleSnapAfterDrag();
      return;
    }

    // --- Resize drag ---
    if (isResizeDragging()) {
      document.body.classList.remove("dragging");

      const drag = finishResizeDrag();
      if (drag) {
        const event = events().find((e) => e.id === drag.event.id);
        const changed = event &&
          (event.start.getTime() !== drag.originalStart.getTime() ||
           event.end.getTime() !== drag.originalEnd.getTime());
        if (event && changed) {
          updateEvent(drag.event.id, { start: event.start, end: event.end });
        }
      }
      return;
    }

    // --- Unfold drag ---
    if (isUnfolding()) {
      stopAutoScroll();
      document.body.classList.remove("dragging");

      const drag = finishUnfoldDrag();
      if (drag) {
        const event = events().find((e) => e.id === drag.event.id);
        const changed = event &&
          (event.start.getTime() !== drag.originalStart.getTime() ||
           event.end.getTime() !== drag.originalEnd.getTime());
        if (event && changed) {
          updateEvent(drag.event.id, { start: event.start, end: event.end });
        }
      }

      settleSnapAfterDrag();
      return;
    }

    // --- Create drag ---
    if (isDragging()) {
      stopAutoScroll();
      finishDrag();
      settleSnapAfterDrag();
    }
  };

  return {
    handleDragPointerMove,
    handleDragPointerUp,
    settleSnapAfterDrag,
    getDateFromClientX,
    getMinutesFromClientY,
  };
}
