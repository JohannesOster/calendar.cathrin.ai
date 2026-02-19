import { createMemo, type Accessor } from "solid-js";
import { addDays } from "../../lib/date-utils";
import {
  CENTER_OFFSET,
  SNAP_TRACK_RANGE,
  VISIBLE_BUFFER_DAYS,
  TIME_COL_WIDTH_FALLBACK,
} from "../../constants/calendar";
import { anchorDate, setAnchorDate, visibleStartDate } from "../../stores/calendar-navigation";
import { visibleDaysCount } from "../../stores/view";

// Pure helpers — no deps needed
export const snapToDevicePixel = (value: number) => {
  const dpr = window.devicePixelRatio || 1;
  return Math.round(value * dpr) / dpr;
};

export const ceilToDevicePixel = (value: number) => {
  const dpr = window.devicePixelRatio || 1;
  return Math.ceil(value * dpr) / dpr;
};

export const getTimeColWidth = () => {
  const cssValue = getComputedStyle(
    document.documentElement,
  ).getPropertyValue("--grid-time-col-width");
  const parsed = parseFloat(cssValue);
  return Number.isFinite(parsed) ? parsed : TIME_COL_WIDTH_FALLBACK;
};

export const getDayLeftPosition = (dayIndex: number, width: number) =>
  CENTER_OFFSET + dayIndex * width;

export interface LayoutResult {
  width: number;
  days: { date: Date; left: number }[];
  leftEdge: number;
  dayAtLeftEdge: number;
}

interface GridLayoutDeps {
  getScrollContainerRef: () => HTMLDivElement | undefined;
  scrollLeft: Accessor<number>;
  containerWidth: Accessor<number>;
  setContainerWidth: (w: number) => void;
  colWidth: Accessor<number>;
  setColWidth: (w: number) => void;
  frozenLayout: Accessor<LayoutResult>;
  setFrozenLayout: (l: LayoutResult) => void;
  isRestoringScrollPosition: Accessor<boolean>;
  setIsRestoringScrollPosition: (v: boolean) => void;
  setScrollLeft: (v: number) => void;
  snapEnabled: Accessor<boolean>;
  setSnapEnabled: (v: boolean) => void;
  snapReEnableTimer: { current: ReturnType<typeof setTimeout> | undefined };
  handleScroll: () => void;
}

export function createGridLayout(deps: GridLayoutDeps) {
  const computeLayout = (width: number, currentScrollLeft: number): LayoutResult => {
    const currentContainerWidth = deps.containerWidth() || window.innerWidth;
    const anchor = anchorDate();
    const timeColWidth = getTimeColWidth();

    const startPixel = currentScrollLeft;
    const endPixel = currentScrollLeft + currentContainerWidth;

    const startIndex =
      Math.floor((startPixel - CENTER_OFFSET) / width) - VISIBLE_BUFFER_DAYS;
    const endIndex =
      Math.ceil((endPixel - CENTER_OFFSET) / width) + VISIBLE_BUFFER_DAYS;

    const days: { date: Date; left: number }[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      days.push({
        date: addDays(anchor, i),
        left: snapToDevicePixel(getDayLeftPosition(i, width)),
      });
    }

    const visualLeftEdge = currentScrollLeft + timeColWidth;
    const dayAtLeftEdge = Math.round(
      (visualLeftEdge - CENTER_OFFSET) / width,
    );
    const leftEdge = snapToDevicePixel(getDayLeftPosition(dayAtLeftEdge, width));

    return { width, days, leftEdge, dayAtLeftEdge };
  };

  const layout = createMemo(() => {
    if (deps.isRestoringScrollPosition()) {
      return deps.frozenLayout();
    }
    return computeLayout(snapToDevicePixel(deps.colWidth()), deps.scrollLeft());
  });

  const visibleDays = createMemo(() => layout().days);

  const calculateColumnWidth = () => {
    const ref = deps.getScrollContainerRef();
    if (!ref) return deps.colWidth();

    const currentContainerWidth = ref.clientWidth;
    if (currentContainerWidth <= 0) return deps.colWidth();

    const timeColWidth = getTimeColWidth();
    const availableWidth = currentContainerWidth - timeColWidth;
    if (availableWidth <= 0) return deps.colWidth();

    return ceilToDevicePixel(availableWidth / visibleDaysCount());
  };

  const getColumnWidth = () => {
    const ref = deps.getScrollContainerRef();
    if (!ref) return deps.colWidth();

    const currentContainerWidth = ref.clientWidth;
    if (currentContainerWidth <= 0) return deps.colWidth();
    deps.setContainerWidth(currentContainerWidth);

    const timeColWidth = getTimeColWidth();
    const availableWidth = currentContainerWidth - timeColWidth;
    if (availableWidth <= 0) return deps.colWidth();

    const width = ceilToDevicePixel(availableWidth / visibleDaysCount());
    if (width > 0) {
      deps.setColWidth(width);
    }
    return width;
  };

  const getScrollLeftForDate = (date: Date, width: number) => {
    const normalizedDate = new Date(date);
    normalizedDate.setHours(0, 0, 0, 0);

    const currentAnchor = anchorDate();
    const diffTime = normalizedDate.getTime() - currentAnchor.getTime();
    let diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    let pendingAnchor: Date | null = null;
    const reanchorThreshold = SNAP_TRACK_RANGE - 30;
    if (Math.abs(diffDays) > reanchorThreshold) {
      const newAnchor = new Date(normalizedDate);
      newAnchor.setDate(normalizedDate.getDate() - normalizedDate.getDay());
      newAnchor.setHours(0, 0, 0, 0);
      pendingAnchor = newAnchor;
      diffDays = Math.round(
        (normalizedDate.getTime() - newAnchor.getTime()) /
          (1000 * 60 * 60 * 24),
      );
    }

    const timeColWidth = getTimeColWidth();
    const scrollLeft = CENTER_OFFSET + diffDays * width - timeColWidth;
    return { scrollLeft, pendingAnchor };
  };

  const commitLayoutTransition = (newColWidth: number, newScrollLeft: number) => {
    const ref = deps.getScrollContainerRef();
    if (!ref) return;

    const currentContainerWidth = ref.clientWidth;
    if (currentContainerWidth > 0) {
      deps.setContainerWidth(currentContainerWidth);
    }

    ref.style.scrollSnapType = "none";

    const finalScrollLeft = snapToDevicePixel(newScrollLeft);

    ref.scrollLeft = finalScrollLeft;
    deps.setFrozenLayout(
      computeLayout(snapToDevicePixel(newColWidth), finalScrollLeft),
    );

    deps.setColWidth(newColWidth);

    requestAnimationFrame(() => {
      const ref2 = deps.getScrollContainerRef();
      if (!ref2) return;
      ref2.scrollLeft = finalScrollLeft;
      deps.setScrollLeft(finalScrollLeft);
      deps.setFrozenLayout(computeLayout(newColWidth, finalScrollLeft));

      requestAnimationFrame(() => {
        const ref3 = deps.getScrollContainerRef();
        if (!ref3) return;
        // Re-assert scroll position: WebKit's snap engine can shift scrollLeft
        // during the paint between rAF1 and rAF2, even with scroll-snap-type: none,
        // when snap-align values on children change (e.g., 7→6 day transition).
        ref3.scrollLeft = finalScrollLeft;
        deps.setIsRestoringScrollPosition(false);
        deps.handleScroll();

        if (deps.snapReEnableTimer.current) {
          clearTimeout(deps.snapReEnableTimer.current);
        }
        deps.snapReEnableTimer.current = setTimeout(() => {
          deps.setSnapEnabled(true);
          deps.snapReEnableTimer.current = undefined;
        }, 50);
      });
    });
  };

  // ResizeObserver management
  let resizeObserver: ResizeObserver | null = null;
  let isInitializedRef = { current: false };

  const setupResizeObserver = (isInitialized: { current: boolean }) => {
    isInitializedRef = isInitialized;

    if (resizeObserver) {
      resizeObserver.disconnect();
    }

    const ref = deps.getScrollContainerRef();
    if (!ref) return;

    resizeObserver = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w > 0 && isInitializedRef.current) {
        getColumnWidth();

        const newColWidth = deps.colWidth();
        const { scrollLeft: newScrollLeft, pendingAnchor } = getScrollLeftForDate(visibleStartDate(), newColWidth);
        if (pendingAnchor) setAnchorDate(pendingAnchor);
        const ref2 = deps.getScrollContainerRef();
        if (ref2) {
          ref2.scrollLeft = newScrollLeft;
        }
      } else if (w > 0) {
        getColumnWidth();
      }
    });
    resizeObserver.observe(ref);

    return resizeObserver;
  };

  return {
    layout,
    visibleDays,
    computeLayout,
    calculateColumnWidth,
    getColumnWidth,
    getScrollLeftForDate,
    commitLayoutTransition,
    setupResizeObserver,
  };
}
