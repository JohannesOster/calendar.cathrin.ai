import type { Accessor } from "solid-js";
import { addDays } from "../../lib/date-utils";
import {
  HOUR_HEIGHT_PX,
  SNAP_MINUTES,
  CREATION_SNAP_MINUTES,
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
  isAllDayMoveDragging, allDayMoveDrag, finishAllDayMoveDrag,
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

  const snapCreationMinutes = (totalMinutes: number): number =>
    Math.round(totalMinutes / CREATION_SNAP_MINUTES) * CREATION_SNAP_MINUTES;

  const recalcDragPosition = () => {
    if (!isDragging() || dragColumnDate === null || dragOriginMinutes === null) return;
    const gridArea = deps.getScrollContainerRef();
    if (!gridArea) return;

    const gridRect = gridArea.getBoundingClientRect();
    const stickyHeaderHeight = MONTH_LABEL_HEIGHT + HEADER_HEIGHT + deps.visualAllDayHeight();

    const mouseY = lastDragClientY - gridRect.top - stickyHeaderHeight + gridArea.scrollTop;
    const totalMinutes = (mouseY / HOUR_HEIGHT_PX) * 60;
    const snapped = snapCreationMinutes(Math.max(0, Math.min(totalMinutes, 24 * 60 - CREATION_SNAP_MINUTES)));

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

  const recalcAllDayMovePosition = () => {
    const drag = allDayMoveDrag();
    if (!drag) return;

    const cursorDate = getDateFromClientX(lastDragClientX);
    if (!cursorDate) return;

    const targetDay = new Date(cursorDate);
    targetDay.setHours(0, 0, 0, 0);

    const originalStartDay = new Date(drag.originalStart);
    originalStartDay.setHours(0, 0, 0, 0);

    // Where the event start should land = cursor day minus grab offset
    const targetStartDay = new Date(targetDay);
    targetStartDay.setDate(targetStartDay.getDate() - drag.grabDayOffset);

    const dayShift = Math.round(
      (targetStartDay.getTime() - originalStartDay.getTime()) / 86_400_000,
    );

    const newStart = new Date(drag.originalStart);
    newStart.setDate(newStart.getDate() + dayShift);
    const newEnd = new Date(drag.originalEnd);
    newEnd.setDate(newEnd.getDate() + dayShift);

    setEvents((prev) =>
      prev.map((e) =>
        e.id === drag.event.id
          ? { ...e, start: newStart, end: newEnd }
          : e
      )
    );
  };

  const recalcAllDayMoveWithScrollSync = () => {
    deps.handleScroll();
    recalcAllDayMovePosition();
  };

  // Wrapper that syncs the scroll signal before recalculating — needed during
  // auto-scroll where container.scrollLeft is updated directly but the signal
  // (and thus layout().days) hasn't caught up via the async scroll event yet.
  const recalcUnfoldWithScrollSync = () => {
    deps.handleScroll();
    recalcUnfoldPosition();
  };

  const recalcUnfoldPosition = () => {
    const drag = unfoldDrag();
    if (!drag) return;

    const cursorDate = getDateFromClientX(lastDragClientX);
    if (!cursorDate) return;

    const targetDay = new Date(cursorDate);
    targetDay.setHours(0, 0, 0, 0);

    // Anchor: the edge NOT being dragged (fixed date + time)
    const anchor = drag.edge === "end"
      ? new Date(drag.originalStart)
      : new Date(drag.originalEnd);

    // Moving: cursor date + original time of the grabbed edge
    const moving = new Date(targetDay);
    const movingTime = drag.edge === "end" ? drag.originalEnd : drag.originalStart;
    moving.setHours(
      movingTime.getHours(),
      movingTime.getMinutes(),
      movingTime.getSeconds(),
      movingTime.getMilliseconds(),
    );

    // Assign chronologically — enables flipping when dragged past the other edge
    const newStart = anchor.getTime() <= moving.getTime() ? anchor : moving;
    const newEnd = anchor.getTime() <= moving.getTime() ? moving : anchor;

    if (newEnd.getTime() <= newStart.getTime()) return;

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
      startAutoScroll(ref, stickyHeaderHeight, recalcUnfoldWithScrollSync, timeColWidth, deps.colWidth(), true);
      updateAutoScrollCursor(e.clientY, e.clientX);

      recalcUnfoldPosition();
      e.preventDefault();
      return;
    }

    // --- All-day move drag ---
    if (isAllDayMoveDragging()) {
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
      startAutoScroll(ref, stickyHeaderHeight, recalcAllDayMoveWithScrollSync, timeColWidth, deps.colWidth(), true);
      updateAutoScrollCursor(e.clientY, e.clientX);

      recalcAllDayMovePosition();
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
          updateEvent(
            drag.event.id,
            { start: event.start, end: event.end },
            { start: drag.originalStart, end: drag.originalEnd },
          );
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
          updateEvent(
            drag.event.id,
            { start: event.start, end: event.end },
            { start: drag.originalStart, end: drag.originalEnd },
          );
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
          updateEvent(
            drag.event.id,
            { start: event.start, end: event.end },
            { start: drag.originalStart, end: drag.originalEnd },
          );
        }
      }

      settleSnapAfterDrag();
      return;
    }

    // --- All-day move drag ---
    if (isAllDayMoveDragging()) {
      stopAutoScroll();
      document.body.classList.remove("dragging");

      const drag = finishAllDayMoveDrag();
      if (drag) {
        const event = events().find((e) => e.id === drag.event.id);
        const changed = event &&
          (event.start.getTime() !== drag.originalStart.getTime() ||
           event.end.getTime() !== drag.originalEnd.getTime());
        if (event && changed) {
          updateEvent(
            drag.event.id,
            { start: event.start, end: event.end },
            { start: drag.originalStart, end: drag.originalEnd },
          );
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
