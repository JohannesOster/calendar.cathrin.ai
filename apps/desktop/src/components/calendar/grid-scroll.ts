import { createSignal, createEffect, createMemo, on, batch, type Accessor } from "solid-js";
import { addDays, isSameDay, getWeekId } from "../../lib/date-utils";
import {
  CENTER_OFFSET,
  SNAP_TRACK_RANGE,
  DIRECTION_THRESHOLD_PX,
  DIRECTION_RESET_DELAY_MS,
} from "../../constants/calendar";
import {
  anchorDate,
  centerDate,
  visibleStartDate,
  setVisibleStartDate,
  visibleWeeks,
  setVisibleWeeks,
  setScrollDirection,
  navigationTarget,
  setNavigationTarget,
} from "../../stores/calendar-navigation";
import {
  currentView,
  visibleDaysCount,
} from "../../stores/view";
import { getTimeColWidth, type LayoutResult } from "./grid-layout";

interface GridScrollDeps {
  getScrollContainerRef: () => HTMLDivElement | undefined;
  isInitialized: { current: boolean };
  isRestoringScrollPosition: Accessor<boolean>;
  setIsRestoringScrollPosition: (v: boolean) => void;
  scrollGeneration: { current: number };
  snapEnabled: Accessor<boolean>;
  setSnapEnabled: (v: boolean) => void;
  snapReEnableTimer: { current: ReturnType<typeof setTimeout> | undefined };
  scrollLeft: Accessor<number>;
  setScrollLeft: (v: number) => void;
  colWidth: Accessor<number>;
  getScrollLeftForDate: (date: Date, width: number) => number;
  getDayLeftPosition: (dayIndex: number, width: number) => number;
  commitLayoutTransition: (newColWidth: number, newScrollLeft: number) => void;
  calculateColumnWidth: () => number;
  getColumnWidth: () => number;
  layout: Accessor<LayoutResult>;
  setupResizeObserver: (isInitialized: { current: boolean }) => ResizeObserver | undefined;
}

export function createGridScroll(deps: GridScrollDeps) {
  // Snap track: floating window of snap points centered around the current scroll position
  const [snapCenter, setSnapCenter] = createSignal(0);

  const snapTrackIndices = createMemo(() => {
    const center = snapCenter();
    const indices: number[] = [];
    for (let i = center - SNAP_TRACK_RANGE; i <= center + SNAP_TRACK_RANGE; i++) {
      indices.push(i);
    }
    return indices;
  });

  // Track scroll direction for prefetching
  let lastScrollLeft = CENTER_OFFSET;
  let directionResetTimer: ReturnType<typeof setTimeout> | undefined;

  const getDayIndexFromScroll = (scroll: number, width: number) => {
    const timeColWidth = getTimeColWidth();
    return Math.round((scroll + timeColWidth - CENTER_OFFSET) / width);
  };

  const handleScroll = () => {
    const ref = deps.getScrollContainerRef();
    if (!ref) return;
    const currentScrollLeft = ref.scrollLeft;

    const width = deps.colWidth();
    const dayIndex = width > 0 ? getDayIndexFromScroll(currentScrollLeft, width) : 0;
    const currentDate = width > 0 ? addDays(anchorDate(), dayIndex) : null;

    let newDirection: "left" | "right" | null = null;
    if (deps.snapEnabled()) {
      if (currentScrollLeft > lastScrollLeft + DIRECTION_THRESHOLD_PX) {
        newDirection = "right";
      } else if (currentScrollLeft < lastScrollLeft - DIRECTION_THRESHOLD_PX) {
        newDirection = "left";
      }
    }

    let newVisibleStart: Date | null = null;
    let newWeeks: string[] | null = null;

    if (currentDate && !deps.isRestoringScrollPosition()) {
      if (!isSameDay(currentDate, visibleStartDate())) {
        newVisibleStart = currentDate;
      }

      const endDate = addDays(currentDate, visibleDaysCount() - 1);
      const startWeek = getWeekId(currentDate);
      const endWeek = getWeekId(endDate);
      const weeksArray = startWeek === endWeek ? [startWeek] : [startWeek, endWeek];
      const currentWeeks = visibleWeeks();
      if (
        weeksArray.length !== currentWeeks.length ||
        weeksArray.some((w, i) => w !== currentWeeks[i])
      ) {
        newWeeks = weeksArray;
      }
    }

    batch(() => {
      deps.setScrollLeft(currentScrollLeft);

      if (newDirection !== null) {
        setScrollDirection(newDirection);
      }
      if (newVisibleStart !== null) {
        setVisibleStartDate(newVisibleStart);
      }
      if (newWeeks !== null) {
        setVisibleWeeks(newWeeks);
      }
    });

    if (Math.abs(dayIndex - snapCenter()) > SNAP_TRACK_RANGE - 30) {
      setSnapCenter(dayIndex);
    }

    if (deps.snapEnabled()) {
      if (directionResetTimer) {
        clearTimeout(directionResetTimer);
      }
      directionResetTimer = setTimeout(() => {
        setScrollDirection(null);
      }, DIRECTION_RESET_DELAY_MS);
    }
    lastScrollLeft = currentScrollLeft;
  };

  const scrollToDate = (date: Date) => {
    const ref = deps.getScrollContainerRef();
    if (!ref) return;

    const currentColWidth = deps.colWidth();
    const targetScrollLeft = deps.getScrollLeftForDate(date, currentColWidth);

    if (Math.abs(ref.scrollLeft - targetScrollLeft) < 1) {
      deps.setIsRestoringScrollPosition(false);
      if (!deps.snapEnabled()) {
        if (deps.snapReEnableTimer.current) {
          clearTimeout(deps.snapReEnableTimer.current);
        }
        deps.snapReEnableTimer.current = setTimeout(() => {
          deps.setSnapEnabled(true);
          deps.snapReEnableTimer.current = undefined;
        }, 50);
      }
      return;
    }

    if (deps.snapReEnableTimer.current) {
      clearTimeout(deps.snapReEnableTimer.current);
      deps.snapReEnableTimer.current = undefined;
    }

    const gen = ++deps.scrollGeneration.current;

    ref.style.scrollSnapType = "none";
    deps.setSnapEnabled(false);

    ref.scrollLeft = targetScrollLeft;

    deps.setIsRestoringScrollPosition(false);

    handleScroll();

    requestAnimationFrame(() => {
      if (gen !== deps.scrollGeneration.current) return;
      const ref2 = deps.getScrollContainerRef();
      if (!ref2) return;
      requestAnimationFrame(() => {
        if (gen !== deps.scrollGeneration.current) return;
        const ref3 = deps.getScrollContainerRef();
        if (!ref3) return;
        ref3.style.scrollSnapType = "";
        deps.setSnapEnabled(true);
      });
    });
  };

  // Track if centerDate was just set (to use it as scroll target instead of visibleStartDate)
  let pendingCenterDate: Date | null = null;

  createEffect(
    on(
      centerDate,
      (date) => {
        pendingCenterDate = date;
      },
      { defer: true },
    ),
  );

  // React to visible days count changes
  createEffect(
    on(
      visibleDaysCount,
      () => {
        const ref = deps.getScrollContainerRef();
        if (deps.isInitialized.current && ref) {
          const navTarget = navigationTarget();
          const pendingTarget = pendingCenterDate;
          const hasExplicitTarget = navTarget !== null || pendingTarget !== null;

          setNavigationTarget(null);
          pendingCenterDate = null;

          deps.setSnapEnabled(false);
          deps.setIsRestoringScrollPosition(true);

          if (hasExplicitTarget) {
            const targetDate = navTarget ?? pendingTarget!;
            const newColWidth = deps.calculateColumnWidth();
            const targetScrollLeft = deps.getScrollLeftForDate(
              targetDate,
              newColWidth,
            );
            deps.commitLayoutTransition(newColWidth, targetScrollLeft);
            if (pendingTarget !== null) {
              skipNextCenterDateScroll = true;
            }
          } else {
            const targetDate = visibleStartDate();
            const newColWidth = deps.calculateColumnWidth();
            const targetScrollLeft = deps.getScrollLeftForDate(
              targetDate,
              newColWidth,
            );
            deps.commitLayoutTransition(newColWidth, targetScrollLeft);
          }
        }
      },
      { defer: true },
    ),
  );

  // Flag to skip centerDate effect when visibleDaysCount effect already handled it
  let skipNextCenterDateScroll = false;

  // React to external centerDate changes
  createEffect(
    on(
      centerDate,
      (target) => {
        pendingCenterDate = null;

        if (skipNextCenterDateScroll) {
          skipNextCenterDateScroll = false;
          return;
        }
        if (navigationTarget() !== null) {
          // Don't clear navigationTarget here — the visibleDaysCount effect
          // is the intended consumer. Clearing it here caused wrong-date bugs:
          // this effect runs first (SolidJS creation-order), consuming the target
          // before the visibleDaysCount effect could use it.
          return;
        }
        if (currentView() !== "Month") {
          scrollToDate(target);
        }
      },
      { defer: true },
    ),
  );

  // View-switch restoration effect: Month -> Week
  createEffect(
    on(
      currentView,
      (view, prevView) => {
        const ref = deps.getScrollContainerRef();
        if (
          prevView === "Month" &&
          view !== "Month" &&
          deps.isInitialized.current &&
          ref
        ) {
          deps.setIsRestoringScrollPosition(true);
          const targetDate = new Date(centerDate());
          requestAnimationFrame(() => {
            deps.setupResizeObserver(deps.isInitialized);
            deps.setSnapEnabled(false);
            deps.getColumnWidth();
            scrollToDate(targetDate);
          });
        }
      },
      { defer: true },
    ),
  );

  return {
    handleScroll,
    scrollToDate,
    snapCenter,
    setSnapCenter,
    snapTrackIndices,
    getDayIndexFromScroll,
    directionResetTimerCleanup: () => {
      if (directionResetTimer) clearTimeout(directionResetTimer);
    },
    /** Expose skipNextCenterDateScroll setter for onMount */
    setSkipNextCenterDateScroll: (v: boolean) => { skipNextCenterDateScroll = v; },
  };
}
