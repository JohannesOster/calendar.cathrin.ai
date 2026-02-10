import {
  createSignal,
  createEffect,
  createMemo,
  on,
  onCleanup,
  untrack,
  batch,
  For,
  type Accessor,
} from "solid-js";
import {
  calculateAllDaySectionHeight,
  type AllDayEventLayout,
} from "./AllDaySection";
import { isSameDay } from "../../lib/date-utils";
import { events } from "../../stores/events";
import { connectedAccounts } from "../../stores/accounts";
import {
  calculateAllDayLayouts,
  daysBetweenUTC,
  daysBetweenViewAndEvent,
  getLocalDateOnly,
  getTimedEventLastDay,
  MS_PER_DAY,
} from "../../utils/allDayLayout";
import {
  isCreating,
  draftIsAllDay,
  draftStart,
  draftEnd,
} from "../../stores/event-creation";
import {
  resizeDragEventId,
  unfoldDrag,
  unfoldDragEventId,
  allDayMoveDrag,
} from "../../stores/event-drag";
import { selectedEvent } from "../../stores/event-selection";
import {
  MONTH_LABEL_HEIGHT,
  HEADER_HEIGHT,
  HOUR_HEIGHT_PX,
  HOURS_PER_DAY,
} from "../../constants/calendar";
import { CHIP_MARGIN_LEFT, CHIP_MARGIN_RIGHT } from "../../constants/layout";
import { FLASH_DURATION_MS } from "../../constants/timings";
import {
  flashDate,
  getDateKey,
} from "../../stores/calendar-navigation";
import { snapToDevicePixel, getTimeColWidth, type LayoutResult } from "./grid-layout";

// Re-export TOTAL_HEIGHT for use in CalendarGrid JSX
export const TOTAL_HEIGHT = HOURS_PER_DAY * HOUR_HEIGHT_PX;

interface AllDayStateDeps {
  layout: Accessor<LayoutResult>;
  visibleDays: Accessor<{ date: Date; left: number }[]>;
  scrollLeft: Accessor<number>;
  containerWidth: Accessor<number>;
  isRestoringScrollPosition: Accessor<boolean>;
}

export function createAllDayState(deps: AllDayStateDeps) {
  // Expand/collapse signals
  const [allDayExpanded, setAllDayExpanded] = createSignal(false);
  const [expandOffset, setExpandOffset] = createSignal(0);
  let expandAnimRaf: number | undefined;

  const toggleAllDayExpanded = () => {
    const currentVisual = allDayHeight() - expandOffset();
    batch(() => {
      setAllDayExpanded((prev) => !prev);
      const newTarget = allDayHeight();
      setExpandOffset(newTarget - currentVisual);
    });
  };

  // Auto-expand all-day section when creating an event that will appear there
  let autoExpandedForCreation = false;
  createEffect(() => {
    const creating = isCreating();
    const allDay = draftIsAllDay();
    const start = draftStart();
    const end = draftEnd();

    let spansMultiple = false;
    if (start && end && !allDay) {
      const effectiveEnd =
        end.getHours() === 0 && end.getMinutes() === 0
          ? new Date(end.getTime() - 1)
          : end;
      spansMultiple = start.toDateString() !== effectiveEnd.toDateString();
    }

    const needsAllDayRow = allDay || spansMultiple;

    if (creating && needsAllDayRow && !allDayExpanded() && !autoExpandedForCreation) {
      setAllDayExpanded(true);
      autoExpandedForCreation = true;
    }
    if (autoExpandedForCreation && creating && !needsAllDayRow) {
      autoExpandedForCreation = false;
      setAllDayExpanded(false);
    }
    if (autoExpandedForCreation && !creating) {
      autoExpandedForCreation = false;
      if (visibleAllDayLayouts().length === 0) {
        setAllDayExpanded(false);
      }
    }
  });

  // Auto-expand all-day section when resize finishes with a multi-day event.
  // During drag the event stays in the time grid (excluded via excludeId);
  // it only moves to the all-day row on pointerup, so we expand then.
  let resizeDragIsMultiDay = false;
  createEffect(() => {
    const eventId = resizeDragEventId();

    if (!eventId) {
      if (resizeDragIsMultiDay && !allDayExpanded()) {
        setAllDayExpanded(true);
      }
      resizeDragIsMultiDay = false;
      return;
    }

    const event = events().find((e) => e.id === eventId);
    if (!event) return;

    const effectiveEnd =
      event.end.getHours() === 0 && event.end.getMinutes() === 0
        ? new Date(event.end.getTime() - 1)
        : event.end;
    resizeDragIsMultiDay = event.start.toDateString() !== effectiveEnd.toDateString();
  });

  // Auto-expand/collapse all-day section when toggling isAllDay in edit mode
  let allDayStateBeforeEdit: boolean | null = null;
  createEffect(() => {
    const event = selectedEvent();
    if (!event) {
      allDayStateBeforeEdit = null;
      return;
    }

    if (event.isAllDay) {
      if (allDayStateBeforeEdit === null) {
        allDayStateBeforeEdit = allDayExpanded();
      }
      if (!allDayExpanded()) {
        setAllDayExpanded(true);
      }
    } else if (allDayStateBeforeEdit !== null) {
      setAllDayExpanded(allDayStateBeforeEdit);
      allDayStateBeforeEdit = null;
    }
  });

  // Get visible calendar IDs for filtering events
  const visibleCalendarIds = createMemo(() => {
    return new Set(
      connectedAccounts()
        .flatMap((a) => a.calendars)
        .filter((c) => c.visible)
        .map((c) => c.id),
    );
  });

  // Raw all-day event layouts (rows may shift during drag)
  const rawAllDayEventLayouts = createMemo((): AllDayEventLayout[] => {
    const days = deps.layout().days;
    if (days.length === 0) return [];

    const width = deps.layout().width;

    const viewStart = days[0].date;
    const viewEnd = days[days.length - 1].date;
    const totalColumns = days.length;

    const visibleIds = visibleCalendarIds();
    const visibleEvents = events().filter((e) => visibleIds.has(e.calendarId));

    const excludeId = resizeDragEventId();
    const forceIncludeId = unfoldDragEventId();
    const layouts = calculateAllDayLayouts(
      visibleEvents,
      viewStart,
      viewEnd,
      totalColumns,
      excludeId,
      forceIncludeId,
    );

    const result: AllDayEventLayout[] = [];
    const firstDayLeft = days[0].left;
    const eventById = new Map(visibleEvents.map((e) => [e.id, e]));

    for (const [eventId, layoutInfo] of layouts) {
      const event = eventById.get(eventId);
      if (!event) continue;

      const chipLeft = snapToDevicePixel(firstDayLeft + layoutInfo.startCol * width);
      const left = layoutInfo.startsBeforeView ? chipLeft : chipLeft + CHIP_MARGIN_LEFT;
      const chipWidth = layoutInfo.span * width - CHIP_MARGIN_RIGHT - (layoutInfo.startsBeforeView ? 0 : CHIP_MARGIN_LEFT);

      result.push({
        event,
        left,
        width: chipWidth,
        row: layoutInfo.row,
        startsBeforeView: layoutInfo.startsBeforeView,
        endsAfterView: layoutInfo.endsAfterView,
      });
    }

    return result;
  });

  // Freeze row assignments during all-day drag to prevent vertical reordering
  const [frozenRowMap, setFrozenRowMap] = createSignal<Map<string, number> | null>(null);

  let wasDraggingAllDay = false;
  createEffect(() => {
    const isDragging = unfoldDrag() !== null || allDayMoveDrag() !== null;
    if (isDragging && !wasDraggingAllDay) {
      const rows = new Map<string, number>();
      for (const layout of untrack(() => rawAllDayEventLayouts())) {
        rows.set(layout.event.id, layout.row);
      }
      setFrozenRowMap(rows);
    } else if (!isDragging && wasDraggingAllDay) {
      setFrozenRowMap(null);
    }
    wasDraggingAllDay = isDragging;
  });

  // Final layouts: applies frozen rows during drag so chips don't jump vertically
  const allDayEventLayouts = createMemo((): AllDayEventLayout[] => {
    const layouts = rawAllDayEventLayouts();
    const frozen = frozenRowMap();
    if (!frozen) return layouts;

    return layouts.map((l) => {
      const frozenRow = frozen.get(l.event.id);
      return frozenRow !== undefined ? { ...l, row: frozenRow } : l;
    });
  });

  // Event counts per day column (for collapsed "X events" label)
  const eventCountsPerDay = createMemo(() => {
    const layouts = allDayEventLayouts();
    const days = deps.layout().days;
    const width = deps.layout().width;

    const counts = new Map<string, number>();

    for (const day of days) {
      const dayKey = getDateKey(day.date);
      const dayStartPx = day.left;
      const dayEndPx = day.left + width;

      let count = 0;
      for (const l of layouts) {
        const eventStartPx = l.left;
        const eventEndPx = l.left + l.width;
        if (eventStartPx < dayEndPx && eventEndPx > dayStartPx) {
          count++;
        }
      }
      counts.set(dayKey, count);
    }

    return counts;
  });

  // Visible day pixel range
  const visibleDayRange = createMemo(() => {
    const timeColWidth = getTimeColWidth();
    const start = deps.scrollLeft() + timeColWidth;
    const end = deps.scrollLeft() + (deps.containerWidth() || window.innerWidth);
    return { start, end };
  });

  const visibleAllDayLayouts = createMemo(() => {
    const layouts = allDayEventLayouts();
    if (layouts.length === 0) return [];

    const { start, end } = visibleDayRange();

    return layouts.filter((l) => {
      const eventEndPx = l.left + l.width;
      return l.left < end && eventEndPx > start;
    });
  });

  const shouldShowToggle = createMemo(() => {
    if (allDayExpanded()) return true;

    const layouts = visibleAllDayLayouts();
    if (layouts.length === 0) return false;

    if (layouts.some((l) => l.row >= 1)) return true;

    const counts = eventCountsPerDay();
    const days = deps.layout().days;
    const width = deps.layout().width;
    const { start, end } = visibleDayRange();

    for (const day of days) {
      if (day.left + width < start || day.left > end) continue;
      const count = counts.get(getDateKey(day.date)) ?? 0;
      if (count > 1) return true;
    }

    return false;
  });

  // All-day creation placeholder row
  const allDayPlaceholderRow = createMemo(() => {
    if (!isCreating() || !draftIsAllDay()) return 0;

    const start = draftStart();
    const end = draftEnd();
    if (!start || !end) return 0;

    const days = deps.visibleDays();
    if (days.length === 0) return 0;
    const width = deps.layout().width;

    const startDay = new Date(start);
    startDay.setHours(0, 0, 0, 0);
    const endDay = new Date(end);
    endDay.setHours(0, 0, 0, 0);

    let firstCol: { left: number } | null = null;
    let lastCol: { left: number } | null = null;

    for (const day of days) {
      const dayMidnight = new Date(day.date);
      dayMidnight.setHours(0, 0, 0, 0);
      const dayTime = dayMidnight.getTime();
      if (dayTime >= startDay.getTime() && dayTime <= endDay.getTime()) {
        if (!firstCol) firstCol = day;
        lastCol = day;
      }
    }

    if (!firstCol || !lastCol) return 0;

    const placeholderLeft = firstCol.left;
    const placeholderRight = lastCol.left + width;

    const layouts = visibleAllDayLayouts();
    if (layouts.length === 0) return 0;

    let row = 0;
    while (true) {
      const hasConflict = layouts.some(
        (l) => l.row === row && l.left < placeholderRight && placeholderLeft < l.left + l.width
      );
      if (!hasConflict) return row;
      row++;
    }
  });

  // Ghost chip layout showing original position during unfold drag
  const unfoldOriginalGhost = createMemo(() => {
    const drag = unfoldDrag();
    if (!drag) return null;

    const days = deps.layout().days;
    if (days.length === 0) return null;

    const width = deps.layout().width;
    const firstDayLeft = days[0].left;
    const totalColumns = days.length;
    const viewStart = days[0].date;

    // Use the same UTC-aware date helpers as calculateAllDayLayouts
    let eventStartOffset: number;
    let eventDurationDays: number;

    if (drag.event.isAllDay) {
      // All-day: UTC dates, exclusive end (Google convention)
      eventDurationDays = daysBetweenUTC(drag.originalStart, drag.originalEnd);
      eventStartOffset = daysBetweenViewAndEvent(viewStart, drag.originalStart);
    } else {
      // Multi-day timed: local dates, inclusive end
      const viewStartDay = getLocalDateOnly(viewStart);
      const startDay = getLocalDateOnly(drag.originalStart);
      const lastDay = getTimedEventLastDay(drag.originalEnd);
      eventDurationDays = Math.round((lastDay - startDay) / MS_PER_DAY) + 1;
      eventStartOffset = Math.round((startDay - viewStartDay) / MS_PER_DAY);
    }

    const startCol = Math.max(0, eventStartOffset);
    const endCol = Math.min(totalColumns - 1, eventStartOffset + eventDurationDays - 1);
    const span = endCol - startCol + 1;

    if (span <= 0) return null;

    const startsBeforeView = eventStartOffset < 0;
    const chipLeft = startsBeforeView
      ? firstDayLeft + startCol * width
      : firstDayLeft + startCol * width + CHIP_MARGIN_LEFT;
    const chipWidth = span * width - CHIP_MARGIN_RIGHT - (startsBeforeView ? 0 : CHIP_MARGIN_LEFT);

    // Find the row of the live event in current layouts
    const layouts = allDayEventLayouts();
    const liveLayout = layouts.find((l) => l.event.id === drag.event.id);
    const row = liveLayout?.row ?? 0;

    return {
      left: chipLeft,
      width: chipWidth,
      color: drag.event.color,
      row,
    };
  });

  // All-day section height
  const allDayHeight = createMemo(() => {
    const layouts = visibleAllDayLayouts();
    const isCreatingAllDay = isCreating() && draftIsAllDay();

    if (layouts.length === 0 && !isCreatingAllDay)
      return calculateAllDaySectionHeight(-1, allDayExpanded());

    const eventsMaxRow = layouts.length === 0 ? -1 : Math.max(...layouts.map((l) => l.row));
    const maxRow = isCreatingAllDay ? Math.max(eventsMaxRow, allDayPlaceholderRow()) : eventsMaxRow;
    return calculateAllDaySectionHeight(maxRow, allDayExpanded());
  });

  // Visual height (animated)
  const visualAllDayHeight = createMemo(() => allDayHeight() - expandOffset());

  let lastVisualHeight = allDayHeight();

  // Animate visualAllDayHeight toward allDayHeight
  createEffect(on(allDayHeight, (newTarget) => {
    const animDelta = newTarget - lastVisualHeight;
    if (animDelta === 0) return;

    setExpandOffset(animDelta);

    const startTime = performance.now();
    const duration = 200;

    if (expandAnimRaf) cancelAnimationFrame(expandAnimRaf);

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 2);
      const remaining = animDelta * (1 - eased);

      setExpandOffset(remaining);
      lastVisualHeight = newTarget - remaining;

      if (progress < 1) {
        expandAnimRaf = requestAnimationFrame(animate);
      } else {
        setExpandOffset(0);
        lastVisualHeight = newTarget;
        expandAnimRaf = undefined;
      }
    };

    expandAnimRaf = requestAnimationFrame(animate);
  }, { defer: true }));

  // Content height
  const contentHeight = createMemo(
    () => MONTH_LABEL_HEIGHT + HEADER_HEIGHT + Math.max(allDayHeight(), visualAllDayHeight()) + TOTAL_HEIGHT,
  );

  // Cleanup
  const cleanupExpandAnimation = () => {
    if (expandAnimRaf) cancelAnimationFrame(expandAnimRaf);
  };

  return {
    allDayExpanded,
    setAllDayExpanded,
    expandOffset,
    toggleAllDayExpanded,
    allDayEventLayouts,
    eventCountsPerDay,
    visibleAllDayLayouts,
    allDayHeight,
    visualAllDayHeight,
    contentHeight,
    unfoldOriginalGhost,
    allDayPlaceholderRow,
    shouldShowToggle,
    visibleCalendarIds,
    cleanupExpandAnimation,
  };
}

// Helper component for all-day section flash overlay
// Needs its own state to track 2-second animation duration independently
export function AllDayFlashOverlay(props: { date: Accessor<Date> }) {
  const [flashKey, setFlashKey] = createSignal(0);
  const [showFlash, setShowFlash] = createSignal(false);

  let flashTimeout: number | undefined;
  createEffect(() => {
    const flash = flashDate();
    if (!flash) return;

    if (isSameDay(flash, props.date())) {
      setFlashKey((k) => k + 1);
      setShowFlash(true);
      if (flashTimeout) clearTimeout(flashTimeout);
      flashTimeout = window.setTimeout(() => setShowFlash(false), FLASH_DURATION_MS);
    } else {
      setShowFlash(false);
    }
  });
  onCleanup(() => {
    if (flashTimeout) clearTimeout(flashTimeout);
  });

  return (
    <For each={showFlash() ? [flashKey()] : []}>
      {() => (
        <div class="absolute inset-0 bg-fg pointer-events-none animate-flash-highlight" />
      )}
    </For>
  );
}
