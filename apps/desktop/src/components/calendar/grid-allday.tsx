import {
  createSignal,
  createEffect,
  createMemo,
  on,
  onCleanup,
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
import { calculateAllDayLayouts } from "../../utils/allDayLayout";
import {
  isCreating,
  draftIsAllDay,
  draftStart,
  draftEnd,
} from "../../stores/event-creation";
import {
  resizeDragEventId,
  unfoldDragEventId,
  unfoldDrag,
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

  // All-day event layouts
  const allDayEventLayouts = createMemo((): AllDayEventLayout[] => {
    const days = deps.layout().days;
    if (days.length === 0) return [];

    const width = deps.layout().width;

    const viewStart = days[0].date;
    const viewEnd = days[days.length - 1].date;
    const totalColumns = days.length;

    const visibleIds = visibleCalendarIds();
    const visibleEvents = events().filter((e) => visibleIds.has(e.calendarId));

    const excludeId = resizeDragEventId() ?? unfoldDragEventId();
    const layouts = calculateAllDayLayouts(
      visibleEvents,
      viewStart,
      viewEnd,
      totalColumns,
      excludeId,
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

  // Unfold ghost chip layout
  const unfoldGhostLayout = createMemo(() => {
    const drag = unfoldDrag();
    if (!drag) return null;

    const days = deps.layout().days;
    if (days.length === 0) return null;

    const width = deps.layout().width;
    const firstDayLeft = days[0].left;

    const getLocalMidnight = (d: Date) => {
      const m = new Date(d);
      m.setHours(0, 0, 0, 0);
      return m;
    };

    const viewStartTime = getLocalMidnight(days[0].date).getTime();
    const startDayTime = getLocalMidnight(drag.originalStart).getTime();

    const endTime = drag.originalEnd.getTime();
    const endForRange =
      drag.originalEnd.getHours() === 0 &&
      drag.originalEnd.getMinutes() === 0 &&
      drag.originalEnd.getSeconds() === 0
        ? endTime - 1
        : endTime;
    const endDayTime = getLocalMidnight(new Date(endForRange)).getTime();

    const msPerDay = 24 * 60 * 60 * 1000;
    const startCol = Math.max(0, Math.round((startDayTime - viewStartTime) / msPerDay));
    const endCol = Math.min(days.length - 1, Math.round((endDayTime - viewStartTime) / msPerDay));
    const span = endCol - startCol + 1;

    if (span <= 0) return null;

    const chipLeft = firstDayLeft + startCol * width + CHIP_MARGIN_LEFT;
    const chipWidth = span * width - CHIP_MARGIN_RIGHT - CHIP_MARGIN_LEFT;

    return {
      left: chipLeft,
      width: chipWidth,
      color: drag.event.color,
    };
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
    unfoldGhostLayout,
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
        <div class="absolute inset-0 bg-accent pointer-events-none animate-flash-highlight" />
      )}
    </For>
  );
}
