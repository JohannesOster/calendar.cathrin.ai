import {
  createSignal,
  onMount,
  onCleanup,
  createEffect,
  createMemo,
  on,
  Show,
  For,
  batch,
  type Accessor,
} from "solid-js";
import { Key } from "@solid-primitives/keyed";
import { ChevronsUpDown, ChevronsDownUp } from "lucide-solid";
import { TimeColumn } from "./TimeColumn";
import { DateHeader } from "./DateHeader";
import { DayColumn, dragColumnDate, dragOriginMinutes } from "./DayColumn";
import { setFocusedEventId } from "./CalendarEvent";
import { DaysStepperButton } from "./DaysStepperButton";
import { CurrentTimeBadge, CurrentTimeLine } from "./CurrentTimeIndicator";
import { MonthView } from "./MonthView";
import {
  calculateAllDaySectionHeight,
  type AllDayEventLayout,
} from "./AllDaySection";
import { AllDayEventChip } from "./AllDayEventChip";
import { AllDayPlaceholder } from "./AllDayPlaceholder";
import {
  addDays,
  isSameDay,
  isToday,
  getWeekId,
} from "../../lib/date-utils";
import { events, setEvents, updateEvent } from "../../stores/events";
import { deleteEvent } from "../../stores/event-deletion";
import { connectedAccounts } from "../../stores/accounts";
import { calculateAllDayLayouts } from "../../utils/allDayLayout";
import {
  currentView,
  visibleDaysCount,
  initVisibleDaysCount,
  createVisibleDaysPersistence,
} from "../../stores/view";
import {
  isDragging,
  isCreating,
  draftTitle,
  draftIsAllDay,
  draftStart,
  draftEnd,
  updateDrag,
  finishDrag,
  cancelCreation,
  snapMinutes,
} from "../../stores/event-creation";
import { HOUR_HEIGHT_PX, SNAP_MINUTES } from "../../constants/calendar";
import { CHIP_MARGIN_LEFT, CHIP_MARGIN_RIGHT, ALL_DAY_ROW_HEIGHT, CHIP_BORDER_RADIUS } from "../../constants/layout";
import { FLASH_DURATION_MS } from "../../constants/timings";
import { selectedEventId, selectedEvent, deselectEvent } from "../../stores/event-selection";
import {
  isMoveDragging, moveDrag, cancelMoveDrag, finishMoveDrag,
  isResizeDragging, resizeDrag, resizeDragEventId, cancelResizeDrag, finishResizeDrag,
  isUnfolding, unfoldDrag, unfoldDragEventId, cancelUnfoldDrag, finishUnfoldDrag,
} from "../../stores/event-drag";
import {
  startAutoScroll,
  updateAutoScrollCursor,
  stopAutoScroll,
} from "../../lib/auto-scroll";

// Helper to create stable date key for <Key> component
const getDateKey = (date: Date): string =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

// Helper to check if a date is a week start (Sunday)
const isWeekStart = (date: Date): boolean => date.getDay() === 0;

// ============================================================================
// Constants - Grid Dimensions
// These should match CSS variables in App.css where applicable
// ============================================================================
const HOURS_PER_DAY = 24;
const HOUR_HEIGHT = 48; // px - matches --grid-hour-height
const MONTH_LABEL_HEIGHT = 36; // px - height of the month/year label row
const HEADER_HEIGHT = 30; // px - matches --grid-header-height
const TIME_COL_WIDTH_FALLBACK = 48; // px - fallback for --grid-time-col-width
// VISIBLE_DAYS_COUNT is now a reactive signal imported from stores/view.ts
const VISIBLE_BUFFER_DAYS = 5; // Extra days to render off-screen for smooth scrolling
const INITIAL_SCROLL_OFFSET_HOURS = 2; // Hours before current time to show on initial load

// Derived dimensions
const TOTAL_HEIGHT = HOURS_PER_DAY * HOUR_HEIGHT;
const ALL_DAY_BASE_HEIGHT = 28; // px - collapsed/minimum height; grid is always positioned here

// ============================================================================
// Constants - Virtual Scroll Container
// ============================================================================
const CONTAINER_WIDTH = 500000; // Large virtual width for infinite scroll
const CENTER_OFFSET = CONTAINER_WIDTH / 2; // Anchor point in middle

// ============================================================================
// Constants - Scroll Snap
// ============================================================================
const SNAP_TRACK_RANGE = 90; // Days in each direction from anchor for snap points (~3 months)

// ============================================================================
// Constants - Scroll Direction Tracking (for prefetching)
// ============================================================================
const DIRECTION_THRESHOLD_PX = 10; // Minimum movement to register direction change
const DIRECTION_RESET_DELAY_MS = 2000; // Reset to null after idle period

// Initial Reference Date (Anchor)
// All positions are calculated relative to this date being at CENTER_OFFSET
// This is now a signal so we can re-anchor when navigating far from current position
const getInitialAnchor = () => {
  const today = new Date();
  const d = new Date(today);
  d.setDate(today.getDate() - today.getDay()); // Start with Sunday
  d.setHours(0, 0, 0, 0);
  return d;
};

const [anchorDate, setAnchorDate] = createSignal(getInitialAnchor());

// Export signals for external control
// Initialize to anchor (Sunday of current week) for consistent startup
export const [centerDate, setCenterDate] = createSignal(
  new Date(getInitialAnchor()),
);
// Flash highlight signal - set this to a date to trigger a flash animation on that day column
export const [flashDate, setFlashDate] = createSignal<Date | null>(null);
// The actual first visible day based on scroll position (updates with daily granularity)
export const [visibleStartDate, setVisibleStartDate] = createSignal(
  new Date(getInitialAnchor()),
);
// Visible weeks signal - contains 1-2 week IDs depending on whether view spans week boundary
export const [visibleWeeks, setVisibleWeeks] = createSignal<string[]>([]);
// Month view visible weeks - contains ~6 week IDs for the visible area in month view
export const [monthVisibleWeekIds, setMonthVisibleWeekIds] = createSignal<
  string[]
>([]);
// Scroll direction signal for prefetching - null when idle, 'left' (past) or 'right' (future)
export const [scrollDirection, setScrollDirection] = createSignal<
  "left" | "right" | null
>(null);

// Navigation target signal - set this SYNCHRONOUSLY before changing visibleDaysCount
// to ensure the visibleDaysCount effect uses the correct target date.
// This avoids race conditions with deferred effects.
export const [navigationTarget, setNavigationTarget] = createSignal<Date | null>(null);

// Active visible weeks - switches between week view and month view based on currentView
// This is the signal that the events store should react to
export const activeVisibleWeeks = createMemo(() => {
  if (currentView() === "Month") {
    return monthVisibleWeekIds();
  }
  return visibleWeeks();
});

// Helper component for all-day section flash overlay
// Needs its own state to track 2-second animation duration independently
function AllDayFlashOverlay(props: { date: Accessor<Date> }) {
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

export function CalendarGrid() {
  let scrollContainerRef: HTMLDivElement | undefined;
  let isInitialized = false;
  // Flag to prevent handleScroll from updating visibleStartDate during view switch
  // (browser scroll restoration can cause stale scroll positions to be read)
  // This is a signal so changes trigger the layout memo to recompute
  const [isRestoringScrollPosition, setIsRestoringScrollPosition] = createSignal(false);

  // Generation counter for scrollToDate - incremented on each call so stale
  // RAF callbacks from previous scrolls can detect they're outdated and bail out.
  let scrollGeneration = 0;

  // Track scroll position for virtualization
  const [scrollLeft, setScrollLeft] = createSignal(CENTER_OFFSET);
  const [containerWidth, setContainerWidth] = createSignal(0);
  const [frozenLayout, setFrozenLayout] = createSignal<{
    width: number;
    days: { date: Date; left: number }[];
    leftEdge: number;
    dayAtLeftEdge: number;
  }>({
    width: 120,
    days: [],
    leftEdge: CENTER_OFFSET,
    dayAtLeftEdge: 0,
  });

  // Signal to track computed column width for responsive layout
  const [colWidth, setColWidth] = createSignal(120);

  const snapToDevicePixel = (value: number) => {
    const dpr = window.devicePixelRatio || 1;
    return Math.round(value * dpr) / dpr;
  };

  // Round UP to device pixel - used for column widths to ensure they fill/overflow viewport
  const ceilToDevicePixel = (value: number) => {
    const dpr = window.devicePixelRatio || 1;
    return Math.ceil(value * dpr) / dpr;
  };

  // Disable scroll snap during programmatic scrolls to prevent feedback loops
  const [snapEnabled, setSnapEnabled] = createSignal(true);
  // Timer reference for re-enabling snap - allows cancellation if new scroll starts
  let snapReEnableTimer: ReturnType<typeof setTimeout> | undefined;

  // All-day section expand/collapse state
  // Uses a JS-driven animation (expandOffset signal) so height changes animate smoothly.
  // The all-day section overlays the grid (negative margin absorbs expansion) — grid never moves.
  const [allDayExpanded, setAllDayExpanded] = createSignal(false);
  const [expandOffset, setExpandOffset] = createSignal(0);
  let expandAnimRaf: number | undefined;

  const toggleAllDayExpanded = () => {
    // Must batch: setAllDayExpanded changes allDayHeight instantly. Without batch,
    // visualAllDayHeight would flash to the target before expandOffset counteracts it.
    const currentVisual = allDayHeight() - expandOffset();
    batch(() => {
      setAllDayExpanded((prev) => !prev);
      const newTarget = allDayHeight();
      setExpandOffset(newTarget - currentVisual);
    });
  };

  // Auto-expand all-day section when creating an event that will appear there.
  // Covers both true all-day events and multi-day timed events (rendered as chips).
  // Only auto-expand once per creation — don't fight the user if they manually collapse.
  let autoExpandedForCreation = false;
  createEffect(() => {
    const creating = isCreating();
    const allDay = draftIsAllDay();
    const start = draftStart();
    const end = draftEnd();

    // Multi-day timed events render as all-day chips — the row needs to be open
    let spansMultiple = false;
    if (start && end && !allDay) {
      // Ending exactly at midnight doesn't count (matches allDayLayout logic)
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
    // Event no longer needs all-day row → collapse (if we auto-expanded)
    if (autoExpandedForCreation && creating && !needsAllDayRow) {
      autoExpandedForCreation = false;
      setAllDayExpanded(false);
    }
    // Creation ended → only collapse if no all-day events remain (i.e. was cancelled)
    if (autoExpandedForCreation && !creating) {
      autoExpandedForCreation = false;
      if (visibleAllDayLayouts().length === 0) {
        setAllDayExpanded(false);
      }
    }
  });

  // Auto-expand/collapse all-day section when toggling isAllDay in edit mode
  // Remember previous state so we can restore it when toggling back
  let allDayStateBeforeEdit: boolean | null = null;
  createEffect(() => {
    const event = selectedEvent();
    if (!event) {
      allDayStateBeforeEdit = null;
      return;
    }

    if (event.isAllDay) {
      // Toggled to all-day → remember current state and expand
      if (allDayStateBeforeEdit === null) {
        allDayStateBeforeEdit = allDayExpanded();
      }
      if (!allDayExpanded()) {
        setAllDayExpanded(true);
      }
    } else if (allDayStateBeforeEdit !== null) {
      // Toggled back to timed → restore previous state
      setAllDayExpanded(allDayStateBeforeEdit);
      allDayStateBeforeEdit = null;
    }
  });

  // Track scroll direction for prefetching
  let lastScrollLeft = CENTER_OFFSET;
  let directionResetTimer: ReturnType<typeof setTimeout> | undefined;

  // Get the time column width from CSS variable
  const getTimeColWidth = () => {
    const cssValue = getComputedStyle(
      document.documentElement,
    ).getPropertyValue("--grid-time-col-width");
    const parsed = parseFloat(cssValue);
    return Number.isFinite(parsed) ? parsed : TIME_COL_WIDTH_FALLBACK;
  };

  // Calculate column width without updating signal (for pre-calculation)
  const calculateColumnWidth = () => {
    if (!scrollContainerRef) return colWidth();

    const currentContainerWidth = scrollContainerRef.clientWidth;
    if (currentContainerWidth <= 0) return colWidth();

    const timeColWidth = getTimeColWidth();
    const availableWidth = currentContainerWidth - timeColWidth;
    if (availableWidth <= 0) return colWidth();

    // Use ceil to ensure columns fill/overflow viewport (hides partial next column)
    return ceilToDevicePixel(availableWidth / visibleDaysCount());
  };

  // Get current column width based on visible area and update signal
  const getColumnWidth = () => {
    if (!scrollContainerRef) return colWidth();

    const currentContainerWidth = scrollContainerRef.clientWidth;
    if (currentContainerWidth <= 0) return colWidth();
    setContainerWidth(currentContainerWidth);

    const timeColWidth = getTimeColWidth();
    const availableWidth = currentContainerWidth - timeColWidth;
    if (availableWidth <= 0) return colWidth();

    // Use ceil to ensure columns fill/overflow viewport (hides partial next column)
    const width = ceilToDevicePixel(availableWidth / visibleDaysCount());
    if (width > 0) {
      setColWidth(width);
    }
    return width;
  };

  // Calculate pixel position for a day index relative to anchor
  const getDayLeftPosition = (dayIndex: number, width: number) =>
    CENTER_OFFSET + dayIndex * width;

  const getScrollLeftForDate = (date: Date, width: number) => {
    // Normalize to midnight to avoid time component affecting day calculation
    const normalizedDate = new Date(date);
    normalizedDate.setHours(0, 0, 0, 0);

    // Calculate difference in days from current anchor
    const currentAnchor = anchorDate();
    const diffTime = normalizedDate.getTime() - currentAnchor.getTime();
    // Use Math.round to handle DST issues (difference should be roughly integer days)
    let diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    // Check if target is outside snap track range - if so, re-anchor
    // Use a slightly smaller threshold to ensure we have snap points around the target
    const reanchorThreshold = SNAP_TRACK_RANGE - 30; // Leave 30-day buffer
    if (Math.abs(diffDays) > reanchorThreshold) {
      // Set new anchor to be the Sunday of the target week
      const newAnchor = new Date(normalizedDate);
      newAnchor.setDate(normalizedDate.getDate() - normalizedDate.getDay());
      newAnchor.setHours(0, 0, 0, 0);
      setAnchorDate(newAnchor);
      // Recalculate diffDays from new anchor
      diffDays = Math.round(
        (normalizedDate.getTime() - newAnchor.getTime()) /
          (1000 * 60 * 60 * 24),
      );
    }

    // Account for sticky time column - position the target day right after the time column
    const timeColWidth = getTimeColWidth();
    return CENTER_OFFSET + diffDays * width - timeColWidth;
  };

  const commitLayoutTransition = (newColWidth: number, newScrollLeft: number) => {
    if (!scrollContainerRef) return;

    const currentContainerWidth = scrollContainerRef.clientWidth;
    if (currentContainerWidth > 0) {
      setContainerWidth(currentContainerWidth);
    }

    // Force-disable scroll snap at the DOM level during the transition.
    // This prevents the browser from nudging scrollLeft while layout changes.
    scrollContainerRef.style.scrollSnapType = "none";

    const finalScrollLeft = snapToDevicePixel(newScrollLeft);

    // Pre-position scroll and freeze layout at the TARGET position.
    // Using scrollContainerRef.scrollLeft is unsafe during view switches because
    // a freshly mounted container starts at scrollLeft=0, which maps to dates
    // decades in the past (e.g., 1986) when fed into computeLayout.
    scrollContainerRef.scrollLeft = finalScrollLeft;
    setFrozenLayout(
      computeLayout(snapToDevicePixel(newColWidth), finalScrollLeft),
    );

    // Update column width, then re-set scroll position after layout settles.
    // The browser may adjust scrollLeft during the width change.
    setColWidth(newColWidth);

    requestAnimationFrame(() => {
      if (!scrollContainerRef) return;
      scrollContainerRef.scrollLeft = finalScrollLeft;
      setScrollLeft(finalScrollLeft);
      setFrozenLayout(computeLayout(newColWidth, finalScrollLeft));

      requestAnimationFrame(() => {
        setIsRestoringScrollPosition(false);
        handleScroll();

        if (snapReEnableTimer) {
          clearTimeout(snapReEnableTimer);
        }
        snapReEnableTimer = setTimeout(() => {
          setSnapEnabled(true);
          snapReEnableTimer = undefined;
        }, 50);
      });
    });
  };

  const computeLayout = (width: number, currentScrollLeft: number) => {
    const currentContainerWidth = containerWidth() || window.innerWidth;
    const anchor = anchorDate();
    const timeColWidth = getTimeColWidth();

    // Calculate day indices relative to anchor (0 = anchor date)
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
    if (isRestoringScrollPosition()) {
      return frozenLayout();
    }
    return computeLayout(snapToDevicePixel(colWidth()), scrollLeft());
  });

  // Calculate visible day range based on scroll position
  const visibleDays = createMemo(() => layout().days);

  // Snap track: floating window of snap points centered around the current scroll position.
  // Only re-centers when approaching the edge, keeping the total div count at ~181.
  const [snapCenter, setSnapCenter] = createSignal(0);

  const snapTrackIndices = createMemo(() => {
    const center = snapCenter();
    const indices: number[] = [];
    for (let i = center - SNAP_TRACK_RANGE; i <= center + SNAP_TRACK_RANGE; i++) {
      indices.push(i);
    }
    return indices;
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

  // Compute the month/year label for the header
  // Format: "January 2025" (single month), "January – February 2025" (same year),
  // or "December 2025 – January 2026" (year boundary)
  const monthYearLabel = createMemo(() => {
    const start = visibleStartDate();
    const end = addDays(start, visibleDaysCount() - 1);

    const startMonth = start.toLocaleDateString("en-US", { month: "long" });
    const endMonth = end.toLocaleDateString("en-US", { month: "long" });
    const startYear = start.getFullYear();
    const endYear = end.getFullYear();

    if (startYear !== endYear) {
      // Year boundary: "December 2025 – January 2026"
      return `${startMonth} ${startYear} – ${endMonth} ${endYear}`;
    }

    if (startMonth !== endMonth) {
      // Different months same year: "January – February 2025"
      return `${startMonth} – ${endMonth} ${endYear}`;
    }

    // Same month: "January 2025"
    return `${startMonth} ${startYear}`;
  });

  // Calculate all-day event layouts for the visible week
  const allDayEventLayouts = createMemo((): AllDayEventLayout[] => {
    const days = layout().days;
    if (days.length === 0) return [];

    const width = layout().width;

    // Use the full range of rendered days (including buffer) for all-day layout
    // This ensures events render into non-visible columns and are ready when scrolled to
    if (days.length === 0) return [];

    const viewStart = days[0].date;
    const viewEnd = days[days.length - 1].date;
    const totalColumns = days.length;

    // Filter to visible calendars
    const visibleIds = visibleCalendarIds();
    const visibleEvents = events().filter((e) => visibleIds.has(e.calendarId));

    // Calculate layouts using the full range of days
    // Exclude the resize-dragged or unfolding event so it stays in the time grid
    const excludeId = resizeDragEventId() ?? unfoldDragEventId();
    const layouts = calculateAllDayLayouts(
      visibleEvents,
      viewStart,
      viewEnd,
      totalColumns,
      excludeId,
    );

    // Convert to pixel positions
    const result: AllDayEventLayout[] = [];
    const firstDayLeft = days[0].left;
    const eventById = new Map(visibleEvents.map((e) => [e.id, e]));

    for (const [eventId, layoutInfo] of layouts) {
      const event = eventById.get(eventId);
      if (!event) continue;

      // Calculate pixel position from column info
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

  // Calculate event counts per day column (for collapsed "X events" label)
  const eventCountsPerDay = createMemo(() => {
    const layouts = allDayEventLayouts();
    const days = layout().days;
    const width = layout().width;

    const counts = new Map<string, number>();

    for (const day of days) {
      const dayKey = getDateKey(day.date);
      const dayStartPx = day.left;
      const dayEndPx = day.left + width;

      let count = 0;
      for (const layout of layouts) {
        const eventStartPx = layout.left;
        const eventEndPx = layout.left + layout.width;

        // Event overlaps with this day column
        if (eventStartPx < dayEndPx && eventEndPx > dayStartPx) {
          count++;
        }
      }
      counts.set(dayKey, count);
    }

    return counts;
  });

  // Filter all-day layouts to those overlapping the visible viewport
  // Visible pixel range for day columns (accounts for sticky time column)
  const visibleDayRange = createMemo(() => {
    const timeColWidth = getTimeColWidth();
    const start = scrollLeft() + timeColWidth;
    const end = scrollLeft() + (containerWidth() || window.innerWidth);
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

  // Check if toggle should show based on visible layouts only
  const shouldShowToggle = createMemo(() => {
    if (allDayExpanded()) return true;

    const layouts = visibleAllDayLayouts();
    if (layouts.length === 0) return false;

    // Show toggle if any visible event is in row 1+ (means stacking exists)
    if (layouts.some((l) => l.row >= 1)) return true;

    // Also check if any visible day has multiple events
    const counts = eventCountsPerDay();
    const days = layout().days;
    const width = layout().width;
    const { start, end } = visibleDayRange();

    for (const day of days) {
      if (day.left + width < start || day.left > end) continue;
      const count = counts.get(getDateKey(day.date)) ?? 0;
      if (count > 1) return true;
    }

    return false;
  });

  // Row where the all-day creation placeholder sits (first row without conflict)
  const allDayPlaceholderRow = createMemo(() => {
    if (!isCreating() || !draftIsAllDay()) return 0;

    const start = draftStart();
    const end = draftEnd();
    if (!start || !end) return 0;

    const days = visibleDays();
    if (days.length === 0) return 0;
    const width = layout().width;

    // Compute placeholder's pixel range (same logic as AllDayPlaceholder)
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

    // Find first row without overlap
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

  // Calculate all-day section height based on max row of VISIBLE layouts
  // Also account for the all-day creation placeholder in its own row
  const allDayHeight = createMemo(() => {
    const layouts = visibleAllDayLayouts();
    const isCreatingAllDay = isCreating() && draftIsAllDay();

    if (layouts.length === 0 && !isCreatingAllDay)
      return calculateAllDaySectionHeight(-1, allDayExpanded());

    const eventsMaxRow = layouts.length === 0 ? -1 : Math.max(...layouts.map((l) => l.row));
    // Placeholder gets its own row below existing events
    const maxRow = isCreatingAllDay ? Math.max(eventsMaxRow, allDayPlaceholderRow()) : eventsMaxRow;
    return calculateAllDaySectionHeight(maxRow, allDayExpanded());
  });

  // Ghost chip layout for unfold drag — shows dashed outline at original chip position
  const unfoldGhostLayout = createMemo(() => {
    const drag = unfoldDrag();
    if (!drag) return null;

    const days = layout().days;
    if (days.length === 0) return null;

    const width = layout().width;
    const firstDayLeft = days[0].left;

    // Calculate which columns the original event spans
    const getLocalMidnight = (d: Date) => {
      const m = new Date(d);
      m.setHours(0, 0, 0, 0);
      return m;
    };

    const viewStartTime = getLocalMidnight(days[0].date).getTime();
    const startDayTime = getLocalMidnight(drag.originalStart).getTime();

    // Handle midnight-exact end times
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

  // Visual height used for all layout positioning — animated smoothly via expandOffset
  const visualAllDayHeight = createMemo(() => allDayHeight() - expandOffset());

  // Track the last rendered visual height so we can animate FROM it when allDayHeight changes.
  // Can't use visualAllDayHeight() inside the effect — by the time it runs, the memo already
  // reflects the new allDayHeight (expandOffset is 0), so animDelta would be 0.
  let lastVisualHeight = allDayHeight();

  // Animate visualAllDayHeight toward allDayHeight whenever allDayHeight changes
  // (toggle, navigation to week with different event count, event created/deleted, etc.)
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
      const eased = 1 - Math.pow(1 - progress, 2); // ease-out quadratic
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

  // Use Math.max to prevent clipping during collapse animation when
  // visualAllDayHeight > allDayHeight temporarily.
  const contentHeight = createMemo(
    () => MONTH_LABEL_HEIGHT + HEADER_HEIGHT + Math.max(allDayHeight(), visualAllDayHeight()) + TOTAL_HEIGHT,
  );

  // Calculate day index from scroll position
  // Account for sticky time column - the visible day starts after the time column
  const getDayIndexFromScroll = (scroll: number, width: number) => {
    const timeColWidth = getTimeColWidth();
    return Math.round((scroll + timeColWidth - CENTER_OFFSET) / width);
  };

  // Handle scroll events
  // Uses batch() to group signal updates and reduce reactive cycles during scroll
  const handleScroll = () => {
    if (!scrollContainerRef) return;
    const currentScrollLeft = scrollContainerRef.scrollLeft;

    // Calculate all values before batching signal updates
    const width = colWidth();
    const dayIndex = width > 0 ? getDayIndexFromScroll(currentScrollLeft, width) : 0;
    const currentDate = width > 0 ? addDays(anchorDate(), dayIndex) : null;

    // Calculate new values outside batch
    let newDirection: "left" | "right" | null = null;
    if (snapEnabled()) {
      if (currentScrollLeft > lastScrollLeft + DIRECTION_THRESHOLD_PX) {
        newDirection = "right";
      } else if (currentScrollLeft < lastScrollLeft - DIRECTION_THRESHOLD_PX) {
        newDirection = "left";
      }
    }

    let newVisibleStart: Date | null = null;
    let newWeeks: string[] | null = null;

    if (currentDate && !isRestoringScrollPosition()) {
      // Calculate visible start date
      if (!isSameDay(currentDate, visibleStartDate())) {
        newVisibleStart = currentDate;
      }

      // Calculate visible weeks
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

    // Batch all signal updates to trigger a single reactive cycle
    batch(() => {
      setScrollLeft(currentScrollLeft);

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

    // Re-center floating snap window when approaching the edge
    if (Math.abs(dayIndex - snapCenter()) > SNAP_TRACK_RANGE - 30) {
      setSnapCenter(dayIndex);
    }

    // Handle direction reset timer outside batch (not a signal update)
    if (snapEnabled()) {
      if (directionResetTimer) {
        clearTimeout(directionResetTimer);
      }
      directionResetTimer = setTimeout(() => {
        setScrollDirection(null);
      }, DIRECTION_RESET_DELAY_MS);
    }
    lastScrollLeft = currentScrollLeft;
  };

  // Virtual Scroll to a specific date
  const scrollToDate = (date: Date) => {
    if (!scrollContainerRef) return;

    const currentColWidth = colWidth();
    const targetScrollLeft = getScrollLeftForDate(date, currentColWidth);

    // Skip scroll if we're already at the target position (within 1px tolerance)
    // This prevents micro-jumps when clicking Today while already viewing today
    if (Math.abs(scrollContainerRef.scrollLeft - targetScrollLeft) < 1) {
      // Still need to clean up state even when skipping the scroll:
      // - Clear isRestoringScrollPosition so handleScroll can update visibleStartDate
      // - Re-enable snap (it may have been disabled by the caller)
      setIsRestoringScrollPosition(false);
      if (!snapEnabled()) {
        if (snapReEnableTimer) {
          clearTimeout(snapReEnableTimer);
        }
        snapReEnableTimer = setTimeout(() => {
          setSnapEnabled(true);
          snapReEnableTimer = undefined;
        }, 50);
      }
      return;
    }

    // Cancel any pending snap re-enable from previous scroll operations
    if (snapReEnableTimer) {
      clearTimeout(snapReEnableTimer);
      snapReEnableTimer = undefined;
    }

    // Invalidate any pending RAF callbacks from previous scrollToDate calls.
    // Without this, a stale callback could fire and re-enable snap at the
    // wrong time, causing the browser to snap back to the old position.
    const gen = ++scrollGeneration;

    // Disable snap directly at the DOM level (bypasses reactive update latency).
    // This is critical: setSnapEnabled(false) goes through SolidJS reactivity,
    // which is synchronous but the browser may not process the CSS change until
    // the next layout. Direct style manipulation ensures snap is truly off
    // before we set scrollLeft.
    scrollContainerRef.style.scrollSnapType = "none";
    setSnapEnabled(false);

    // Scroll immediately — snap is already disabled at the DOM level
    scrollContainerRef.scrollLeft = targetScrollLeft;

    // Allow handleScroll to update visibleStartDate
    setIsRestoringScrollPosition(false);

    // Explicitly update state after programmatic scroll
    // (browser scroll events may not fire reliably for programmatic changes)
    handleScroll();

    // Re-enable snap after the browser has painted the new position.
    // Using double-RAF ensures at least one full paint cycle has committed
    // the scroll position, so re-enabling mandatory snap won't snap-back.
    requestAnimationFrame(() => {
      if (gen !== scrollGeneration || !scrollContainerRef) return;
      requestAnimationFrame(() => {
        if (gen !== scrollGeneration || !scrollContainerRef) return;
        // Remove the direct style override so the reactive style takes over
        scrollContainerRef.style.scrollSnapType = "";
        setSnapEnabled(true);
      });
    });
  };

  // ResizeObserver instance - stored so we can re-attach after view switches
  let resizeObserver: ResizeObserver | null = null;

  // Setup/re-attach ResizeObserver to the scroll container
  const setupResizeObserver = () => {
    // Disconnect any existing observer
    if (resizeObserver) {
      resizeObserver.disconnect();
    }

    if (!scrollContainerRef) return;

    resizeObserver = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w > 0 && isInitialized) {
        // Update column width based on new container size
        getColumnWidth();

        // Reposition to keep the same date visible using visibleStartDate.
        // Using the date signal is more robust than pixel-based dayIndex calculation
        // which can amplify drift when colWidth is very small during initial layout.
        const newColWidth = colWidth();
        const newScrollLeft = getScrollLeftForDate(visibleStartDate(), newColWidth);
        scrollContainerRef!.scrollLeft = newScrollLeft;
      } else if (w > 0) {
        // Not initialized yet, just update column width
        getColumnWidth();
      }
    });
    resizeObserver.observe(scrollContainerRef);
  };

  // Initialize on mount
  onMount(() => {
    // Initialize visible days count from localStorage
    initVisibleDaysCount();

    // Re-anchor to the current week on every mount.
    // Module-level signals (anchorDate, centerDate) are initialized once at import time
    // and can become stale if the dev server / HMR keeps the module cached across days.
    const freshAnchor = getInitialAnchor();
    setAnchorDate(freshAnchor);
    setSnapCenter(0);

    // Ensure the view starts with today visible:
    // - 7+ days: start at Sunday of current week (full week visible, today included)
    // - <7 days: start at today directly (same logic as the "Today" button)
    // IMPORTANT: skipNextCenterDateScroll prevents the deferred centerDate effect from
    // firing scrollToDate() with stale colWidth (still default 120). The onMount RAF
    // below handles the initial scroll with the correctly calculated colWidth.
    skipNextCenterDateScroll = true;
    if (visibleDaysCount() < 7) {
      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0);
      setCenterDate(todayDate);
      setVisibleStartDate(todayDate);
    } else {
      setCenterDate(new Date(freshAnchor));
      setVisibleStartDate(new Date(freshAnchor));
    }

    // Disable scroll snap during initialization to prevent the browser from
    // hijacking the scroll position while the container is resizing (sidebar animation).
    // Without this, mandatory snap fires between ResizeObserver callbacks and jumps
    // to the edge of the snap track (day ±90) instead of staying at day 0.
    setSnapEnabled(false);

    // Initial setup
    getColumnWidth();

    // Set initial scroll position directly (no RAF dance needed on mount)
    requestAnimationFrame(() => {
      if (scrollContainerRef) {
        // Calculate initial scroll position for today
        const today = centerDate();
        const normalizedDate = new Date(today);
        normalizedDate.setHours(0, 0, 0, 0);
        const currentAnchor = anchorDate();
        const diffTime = normalizedDate.getTime() - currentAnchor.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
        const timeColWidth = getTimeColWidth();
        const currentColWidth = colWidth();
        const targetScrollLeft =
          CENTER_OFFSET + diffDays * currentColWidth - timeColWidth;

        // Set scroll position directly
        scrollContainerRef.scrollLeft = targetScrollLeft;

        // Vertical scroll to show current time with some context above
        const currentHour = new Date().getHours();
        const scrollPosition = Math.max(
          0,
          (currentHour - INITIAL_SCROLL_OFFSET_HOURS) * HOUR_HEIGHT,
        );
        scrollContainerRef.scrollTop = scrollPosition;

        // Force initial update of signals
        handleScroll();

        isInitialized = true;

        // Clear skip flag — the initial scroll is handled by this RAF,
        // so future centerDate changes (e.g. Today button) should scroll normally.
        // This is needed because SolidJS batches effects during the initial render
        // cycle, so the deferred centerDate effect may not fire from onMount's
        // setCenterDate call, leaving skipNextCenterDateScroll stuck at true.
        skipNextCenterDateScroll = false;

        // Re-enable scroll snap after container layout has settled.
        // Sidebar animation is ~200ms; wait 300ms to be safe.
        setTimeout(() => {
          setSnapEnabled(true);
        }, 300);
      }
    });

    // Setup initial ResizeObserver
    if (scrollContainerRef) {
      setupResizeObserver();
      onCleanup(() => resizeObserver?.disconnect());
    }

    // Keyboard handlers
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Cancel move drag on Escape — revert to original position
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
        // Cancel resize drag on Escape — revert to original size
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
        // Cancel unfold drag on Escape — revert to original times
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
          // During drag: always cancel
          // After drag (form open): cancel if no title entered
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
            // All-day event — delete immediately
            deleteEvent(eventId);
          } else {
            // Timed event — play burn animation via exposed method, then delete
            const wrapper = eventWrapper as HTMLElement & { triggerBurn?: () => void };
            wrapper.triggerBurn?.();
          }
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));

    // Clear event focus when clicking outside any event chip.
    // Must also blur the DOM element — CSS :focus styles persist otherwise
    // because DayColumn's mousedown calls e.preventDefault() which suppresses
    // the browser's default blur behavior.
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

    // Document-level drag handlers for event creation
    let lastDragClientY = 0;
    let lastDragClientX = 0;

    /** Map a viewport X coordinate to a calendar date using grid layout math. */
    const getDateFromClientX = (clientX: number): Date | null => {
      const gridArea = scrollContainerRef;
      if (!gridArea) return null;

      const gridRect = gridArea.getBoundingClientRect();
      const virtualX = clientX - gridRect.left + gridArea.scrollLeft;
      const currentColWidth = colWidth();
      if (currentColWidth <= 0) return null;

      const dayIndex = Math.floor((virtualX - CENTER_OFFSET) / currentColWidth);
      return addDays(anchorDate(), dayIndex);
    };

    /** Calculate minutes-from-midnight from a viewport Y coordinate. */
    const getMinutesFromClientY = (clientY: number): number => {
      const gridArea = scrollContainerRef;
      if (!gridArea) return 0;

      const gridRect = gridArea.getBoundingClientRect();
      const stickyHeaderHeight = MONTH_LABEL_HEIGHT + HEADER_HEIGHT + visualAllDayHeight();
      const mouseY = clientY - gridRect.top - stickyHeaderHeight + gridArea.scrollTop;
      const totalMinutes = (mouseY / HOUR_HEIGHT_PX) * 60;
      return snapMinutes(Math.max(0, Math.min(totalMinutes, 24 * 60 - SNAP_MINUTES)));
    };

    /** Recalculate draft position from the last-known cursor X/Y. Called from
     *  mousemove AND from auto-scroll tick (so the event extends while the
     *  cursor is stationary at an edge). */
    const recalcDragPosition = () => {
      if (!isDragging() || dragColumnDate === null || dragOriginMinutes === null) return;
      const gridArea = scrollContainerRef;
      if (!gridArea) return;

      const gridRect = gridArea.getBoundingClientRect();
      const stickyHeaderHeight = MONTH_LABEL_HEIGHT + HEADER_HEIGHT + visualAllDayHeight();

      const mouseY = lastDragClientY - gridRect.top - stickyHeaderHeight + gridArea.scrollTop;
      const totalMinutes = (mouseY / HOUR_HEIGHT_PX) * 60;
      const snapped = snapMinutes(Math.max(0, Math.min(totalMinutes, 24 * 60 - SNAP_MINUTES)));

      const currentDate = getDateFromClientX(lastDragClientX) ?? dragColumnDate;
      updateDrag(dragOriginMinutes, snapped, dragColumnDate, currentDate);
    };

    // -----------------------------------------------------------------------
    // Move-drag: update event position in real time
    // -----------------------------------------------------------------------
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

      // Clamp: don't let event spill past midnight into the next day
      const dayMidnight = new Date(newStart);
      dayMidnight.setHours(24, 0, 0, 0);
      if (newEnd.getTime() > dayMidnight.getTime()) {
        const durationMinutes = Math.round(durationMs / 60000);
        const clampedStartMinutes = Math.max(0, 24 * 60 - durationMinutes);
        newStart.setHours(0, 0, 0, 0);
        newStart.setMinutes(clampedStartMinutes);
        newEnd = new Date(newStart.getTime() + durationMs);
      }

      // Optimistic position update during drag
      setEvents((prev) =>
        prev.map((e) =>
          e.id === drag.event.id
            ? { ...e, start: newStart, end: newEnd }
            : e
        )
      );
    };

    // -----------------------------------------------------------------------
    // Resize-drag: update event end time in real time
    // -----------------------------------------------------------------------
    const recalcResizePosition = () => {
      const drag = resizeDrag();
      if (!drag) return;

      const cursorMinutes = getMinutesFromClientY(lastDragClientY);
      const cursorDate = getDateFromClientX(lastDragClientX);

      // Anchor = the fixed end of the event (original start time)
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
        // Dragging forward: anchor is start, cursor is end
        newStart = anchorDateTime;
        newEnd = cursorDateTime;
        if (newEnd.getTime() - newStart.getTime() < SNAP_MINUTES * 60000) {
          newEnd = new Date(newStart.getTime() + SNAP_MINUTES * 60000);
        }
      } else {
        // Dragging backward: cursor is start, anchor is end
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

    // -----------------------------------------------------------------------
    // Unfold-drag: multi-day timed chip edge → time grid resize
    // -----------------------------------------------------------------------
    const recalcUnfoldPosition = () => {
      const drag = unfoldDrag();
      if (!drag) return;

      const cursorMinutes = getMinutesFromClientY(lastDragClientY);
      const cursorDate = getDateFromClientX(lastDragClientX);

      // The anchor is the OPPOSITE edge from what was grabbed
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

      // --- Move drag ---
      if (isMoveDragging()) {
        if (!scrollContainerRef) return;

        // Add grabbing cursor to body
        if (!document.body.classList.contains("dragging")) {
          document.body.classList.add("dragging");
        }

        // Disable scroll snap during drag
        if (snapEnabled()) {
          scrollContainerRef.style.scrollSnapType = "none";
          setSnapEnabled(false);
        }

        const timeColWidth = getTimeColWidth();
        const stickyHeaderHeight = MONTH_LABEL_HEIGHT + HEADER_HEIGHT + visualAllDayHeight();
        startAutoScroll(scrollContainerRef, stickyHeaderHeight, recalcMovePosition, timeColWidth, colWidth());
        updateAutoScrollCursor(e.clientY, e.clientX);

        recalcMovePosition();
        e.preventDefault();
        return;
      }

      // --- Resize drag ---
      if (isResizeDragging()) {
        if (!scrollContainerRef) return;

        if (!document.body.classList.contains("dragging")) {
          document.body.classList.add("dragging");
        }

        // Disable scroll snap during drag so horizontal auto-scroll works
        if (snapEnabled()) {
          scrollContainerRef.style.scrollSnapType = "none";
          setSnapEnabled(false);
        }

        const timeColWidth = getTimeColWidth();
        const stickyHeaderHeight = MONTH_LABEL_HEIGHT + HEADER_HEIGHT + visualAllDayHeight();
        startAutoScroll(scrollContainerRef, stickyHeaderHeight, recalcResizePosition, timeColWidth, colWidth());
        updateAutoScrollCursor(e.clientY, e.clientX);

        recalcResizePosition();
        e.preventDefault();
        return;
      }

      // --- Unfold drag ---
      if (isUnfolding()) {
        if (!scrollContainerRef) return;

        if (!document.body.classList.contains("dragging")) {
          document.body.classList.add("dragging");
        }

        if (snapEnabled()) {
          scrollContainerRef.style.scrollSnapType = "none";
          setSnapEnabled(false);
        }

        const timeColWidth = getTimeColWidth();
        const stickyHeaderHeight = MONTH_LABEL_HEIGHT + HEADER_HEIGHT + visualAllDayHeight();
        startAutoScroll(scrollContainerRef, stickyHeaderHeight, recalcUnfoldPosition, timeColWidth, colWidth());
        updateAutoScrollCursor(e.clientY, e.clientX);

        recalcUnfoldPosition();
        e.preventDefault();
        return;
      }

      // --- Create drag ---
      if (!isDragging() || dragColumnDate === null || dragOriginMinutes === null) return;
      if (!scrollContainerRef) return;

      // Disable scroll snap during drag so horizontal auto-scroll doesn't fight it
      if (snapEnabled()) {
        scrollContainerRef.style.scrollSnapType = "none";
        setSnapEnabled(false);
      }

      const stickyHeaderHeight = MONTH_LABEL_HEIGHT + HEADER_HEIGHT + visualAllDayHeight();
      const timeColWidth = getTimeColWidth();
      startAutoScroll(scrollContainerRef, stickyHeaderHeight, recalcDragPosition, timeColWidth, colWidth());
      updateAutoScrollCursor(e.clientY, e.clientX);

      recalcDragPosition();
      e.preventDefault();
    };

    /** Settle scroll snap after any drag operation ends. */
    const settleSnapAfterDrag = () => {
      if (!scrollContainerRef) return;
      const currentScrollLeft = scrollContainerRef.scrollLeft;
      const timeColWidth = getTimeColWidth();
      const currentColWidth = colWidth();
      const visualLeftEdge = currentScrollLeft + timeColWidth;
      const dayIndex = Math.round((visualLeftEdge - CENTER_OFFSET) / currentColWidth);
      const snappedScrollLeft = CENTER_OFFSET + dayIndex * currentColWidth - timeColWidth;
      scrollContainerRef.scrollLeft = snappedScrollLeft;
      handleScroll();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (scrollContainerRef) {
            scrollContainerRef.style.scrollSnapType = "";
          }
          setSnapEnabled(true);
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

    document.addEventListener("pointermove", handleDragPointerMove);
    document.addEventListener("pointerup", handleDragPointerUp);
    onCleanup(() => {
      stopAutoScroll();
      document.body.classList.remove("dragging");
      document.removeEventListener("pointermove", handleDragPointerMove);
      document.removeEventListener("pointerup", handleDragPointerUp);
    });

    // Cleanup direction reset timer
    onCleanup(() => {
      if (directionResetTimer) {
        clearTimeout(directionResetTimer);
      }
    });

    // Cleanup snap re-enable timer
    onCleanup(() => {
      if (snapReEnableTimer) {
        clearTimeout(snapReEnableTimer);
      }
    });

    // Cleanup expand animation
    onCleanup(() => {
      if (expandAnimRaf) cancelAnimationFrame(expandAnimRaf);
    });

  });

  // Persist visible days count to localStorage
  createVisibleDaysPersistence();

  // Track if centerDate was just set (to use it as scroll target instead of visibleStartDate)
  let pendingCenterDate: Date | null = null;

  // Watch for centerDate changes and mark as pending
  createEffect(
    on(
      centerDate,
      (date) => {
        pendingCenterDate = date;
      },
      { defer: true },
    ),
  );

  // React to visible days count changes - recalculate column width and adjust scroll
  createEffect(
    on(
      visibleDaysCount,
      () => {
        if (isInitialized && scrollContainerRef) {
          // Priority order for target:
          // 1. navigationTarget (module-level signal, set synchronously from click handlers)
          // 2. pendingCenterDate (local var, set by deferred centerDate effect)
          // 3. Preserve exact fractional scroll position (for +/- stepper)
          const navTarget = navigationTarget();
          const pendingTarget = pendingCenterDate;
          const hasExplicitTarget = navTarget !== null || pendingTarget !== null;

          const currentScrollLeft = scrollContainerRef.scrollLeft;
          const oldColWidth = colWidth();
          const timeColWidth = getTimeColWidth();

          // Clear both pending values since we're handling them
          setNavigationTarget(null);
          pendingCenterDate = null;

          // Disable snap BEFORE updating column width to prevent browser auto-snap
          // during the layout change (which causes visual flickering)
          setSnapEnabled(false);

          // CRITICAL: Prevent handleScroll from updating visibleStartDate while we transition.
          // When colWidth changes, the same scrollLeft maps to a different dayIndex.
          // Any scroll event between getColumnWidth() and scrollToDate() would calculate
          // the wrong day and cause the header to flicker.
          setIsRestoringScrollPosition(true);

          if (hasExplicitTarget) {
            // Use explicit target date (Day button, navigation, etc.)
            // Apply scroll and width in the same frame to avoid flicker.
            const targetDate = navTarget ?? pendingTarget!;
          const newColWidth = calculateColumnWidth();
            const targetScrollLeft = getScrollLeftForDate(
              targetDate,
              newColWidth,
            );
            commitLayoutTransition(newColWidth, targetScrollLeft);
            // Only skip the next centerDate scroll if centerDate actually changed
            // in this batch (pendingTarget !== null). When only navigationTarget
            // was set (e.g., +/- stepper), centerDate didn't change, so the
            // centerDate effect won't fire and the flag would get stuck — blocking
            // the next legitimate centerDate navigation (Today button, arrows).
            if (pendingTarget !== null) {
              skipNextCenterDateScroll = true;
            }
          } else {
            // Fallback: use the current visible date as the target.
            // This is safer than pixel-based math which can amplify rounding
            // errors or be corrupted by stale scroll positions (e.g., snap
            // jumping to the edge of the snap track during layout transitions).
            const targetDate = visibleStartDate();
            const newColWidth = calculateColumnWidth();
            const targetScrollLeft = getScrollLeftForDate(
              targetDate,
              newColWidth,
            );
            commitLayoutTransition(newColWidth, targetScrollLeft);
          }
        }
      },
      { defer: true },
    ),
  );

  // Flag to skip centerDate effect when visibleDaysCount effect already handled it
  let skipNextCenterDateScroll = false;

  // React to external centerDate changes (e.g. from Mini Calendar or header navigation)
  // Using on() with defer to only react when centerDate actually changes,
  // not on initial mount (handled by onMount)
  // Note: Month view manages its own scroll via MonthView component
  createEffect(
    on(
      centerDate,
      (target) => {
        // Always clear pendingCenterDate when centerDate changes, regardless of
        // which branch handles the scroll. Without this, early returns below
        // leave pendingCenterDate stale, and the next visibleDaysCount change
        // would jump to that old date instead of staying at visibleStartDate.
        pendingCenterDate = null;

        if (skipNextCenterDateScroll) {
          skipNextCenterDateScroll = false;
          return;
        }
        // Skip if visibleDaysCount effect will handle this scroll.
        // This happens when Day button sets both centerDate and visibleDaysCount together.
        // Clear navigationTarget defensively — if visibleDaysCount didn't change,
        // the visibleDaysCount effect won't fire to clear it, and a stale value
        // would block all future centerDate-driven scrolls (including Today).
        if (navigationTarget() !== null) {
          setNavigationTarget(null);
          return;
        }
        if (currentView() !== "Month") {
          scrollToDate(target);
        }
      },
      { defer: true },
    ),
  );

  // When switching from Month view back to Week view, restore scroll position,
  // re-attach ResizeObserver, and update visibleWeeks signal (since onMount doesn't run again)
  createEffect(
    on(
      currentView,
      (view, prevView) => {
        if (
          prevView === "Month" &&
          view !== "Month" &&
          isInitialized &&
          scrollContainerRef
        ) {
          // Prevent handleScroll from overwriting visibleStartDate with stale scroll position
          // (browser scroll restoration can restore old positions to the new element)
          setIsRestoringScrollPosition(true);
          // Use centerDate as the scroll target — it's always set to the correct week
          // before a view switch (by CalendarHeader or MonthDayCell). Using visibleStartDate
          // would scroll to whichever week was at the top of the MonthView viewport, which
          // can be 1-2 weeks off from the clicked day's week.
          const targetDate = new Date(centerDate());
          // Give the DOM time to render the week view container
          requestAnimationFrame(() => {
            // Re-attach ResizeObserver to the new scroll container element
            // (the old one was unmounted when we switched to Month view)
            setupResizeObserver();
            // Disable snap before updating column width to prevent auto-snap flickering
            setSnapEnabled(false);
            // Update column width for the new container size
            getColumnWidth();
            // scrollToDate handles calling handleScroll internally after setting position
            // It will clear isRestoringScrollPosition after the scroll completes
            scrollToDate(targetDate);
          });
        }
      },
      { defer: true },
    ),
  );

  return (
    <div class="flex-1 flex flex-col max-h-full overflow-hidden relative">
      <Show
        when={currentView() === "Month"}
        fallback={
          /* ONE Main Scroll Container - Week View */
          <div
            ref={scrollContainerRef}
            class="flex-1 overflow-auto overscroll-none scrollbar-hidden"
            style={{
              position: "relative",
              "scroll-snap-type": snapEnabled() ? "x mandatory" : "none",
              "scroll-padding-left": "var(--grid-time-col-width)",
              "overscroll-behavior": "none",
              "overflow-anchor": "none", // Prevent browser scroll anchoring during resize
            }}
            onScroll={handleScroll}
          >
            {/* Inner Virtual Container - Extremely Wide */}
            <div
              style={{
                width: `${CONTAINER_WIDTH}px`,
                height: `${contentHeight()}px`,
                position: "relative",
              }}
            >
              {/* Fixed vertical separator at time column boundary */}
              <div
                class="pointer-events-none"
                style={{
                  position: "absolute",
                  left: "var(--grid-time-col-width)",
                  top: "0",
                  width: "1px",
                  height: `${contentHeight()}px`,
                  "background-color": "var(--color-border)",
                  "z-index": "22",
                }}
              />
              {/* Sticky Month/Year Label Row - sticky in both directions */}
              <div
                class="flex bg-surface"
                style={{
                  position: "sticky",
                  top: "0",
                  left: "0",
                  "z-index": "11",
                  height: `${MONTH_LABEL_HEIGHT}px`,
                  width: `${containerWidth() || window.innerWidth}px`,
                  transform: "translateZ(0)",
                  contain: "layout",
                }}
              >
                <div
                  class="bg-surface flex items-end pb-1 pl-3"
                >
                  <span class="text-fg text-lg font-semibold whitespace-nowrap">
                    {monthYearLabel()}
                  </span>
                </div>

                {/* Days Stepper Button - positioned at right edge */}
                <div
                  class="flex items-center pr-2"
                  style={{
                    "margin-left": "auto",
                    "padding-left": "16px",
                    background:
                      "linear-gradient(to right, transparent, var(--color-surface) 8px)",
                  }}
                >
                  <DaysStepperButton />
                </div>
              </div>

              {/* Sticky Date Header Row */}
              <div
                class="flex bg-surface border-b border-border"
                style={{
                  position: "sticky",
                  top: `${MONTH_LABEL_HEIGHT}px`,
                  "z-index": "10",
                  height: `${HEADER_HEIGHT}px`,
                  width: "100%",
                  transform: "translateZ(0)",
                  contain: "layout",
                }}
              >
                {/* Sticky Time Column Header */}
                <div
                  class="bg-surface border-b border-border"
                  style={{
                    width: "var(--grid-time-col-width)",
                    "min-width": "var(--grid-time-col-width)",
                    "max-width": "var(--grid-time-col-width)",
                    height: `${HEADER_HEIGHT}px`,
                    "flex-shrink": "0",
                    position: "sticky",
                    left: "0",
                    "z-index": "20",
                    overflow: "hidden",
                  }}
                />

                {/* Absolute Date Headers */}
                <Key each={visibleDays()} by={(d) => getDateKey(d.date)}>
                  {(item) => (
                    <div
                      class="absolute bg-surface"
                      style={{
                        left: "0",
                        transform: `translateX(${item().left}px)`,
                        width: `${layout().width}px`,
                        height: `${HEADER_HEIGHT}px`,
                        top: 0,
                      }}
                    >
                      <DateHeader
                        date={item().date}
                        isToday={isToday(item().date)}
                      />
                    </div>
                  )}
                </Key>
              </div>

              {/* Sticky All-Day Section Row */}
              <div
                class="flex bg-surface border-b border-border transition-[box-shadow] duration-200 ease-out"
                style={{
                  position: "sticky",
                  top: `${MONTH_LABEL_HEIGHT + HEADER_HEIGHT}px`,
                  "z-index": "10",
                  height: `${visualAllDayHeight()}px`,
                  "margin-bottom": `${-(visualAllDayHeight() - ALL_DAY_BASE_HEIGHT)}px`,
                  "box-shadow": allDayExpanded() ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
                  width: "100%",
                  transform: "translateZ(0)",
                  contain: "layout",
                }}
              >
                {/* Sticky Time column corner */}
                <div
                  class="bg-surface border-r border-b border-border flex items-start justify-end pt-1 pr-2"
                  style={{
                    width: "var(--grid-time-col-width)",
                    "min-width": "var(--grid-time-col-width)",
                    "max-width": "var(--grid-time-col-width)",
                    height: `${visualAllDayHeight()}px`,
                    "flex-shrink": "0",
                    position: "sticky",
                    left: "0",
                    "z-index": "20",
                    overflow: "hidden",
                  }}
                >
                  {/* Show toggle button if multiple events, or "All day" label if single events */}
                  {/* Hide during view transitions to prevent flicker */}
                  <Show when={!isRestoringScrollPosition()}>
                    <Show
                      when={shouldShowToggle()}
                      fallback={
                        <Show when={allDayEventLayouts().length > 0 || (isCreating() && draftIsAllDay())}>
                          <span class="text-[10px] text-fg-muted font-light">
                            All day
                          </span>
                        </Show>
                      }
                    >
                      <button
                        class="text-fg-muted hover:text-fg hover:bg-surface-hover rounded py-0.5 pl-0.5 transition-colors"
                        onClick={toggleAllDayExpanded}
                        tabIndex={0}
                        aria-label={
                          allDayExpanded()
                            ? "Collapse all-day events"
                            : "Expand all-day events"
                        }
                      >
                        {allDayExpanded() ? (
                          <ChevronsDownUp size={14} />
                        ) : (
                          <ChevronsUpDown size={14} />
                        )}
                      </button>
                    </Show>
                  </Show>
                </div>

                {/* Clipping wrapper - covers full row, clips chips during height animation */}
                <div class="absolute inset-0 overflow-hidden" style={{ "z-index": "1" }}>
                  {/* Absolute day slots - matches header date slots */}
                  <Key each={visibleDays()} by={(d) => getDateKey(d.date)}>
                    {(item) => (
                      <div
                        class="absolute border-l border-b border-border bg-surface"
                        style={{
                          left: "0",
                          transform: `translateX(${item().left}px)`,
                          width: `${layout().width}px`,
                          height: `${visualAllDayHeight()}px`,
                          top: 0,
                        }}
                      >
                        <AllDayFlashOverlay date={() => item().date} />
                      </div>
                    )}
                  </Key>

                  {/* All-day event chips (when expanded, or for columns with single events when collapsed) */}
                  <Show
                    when={allDayExpanded()}
                    fallback={
                      <>
                        {/* When collapsed: show chips only for columns with single events */}
                        {/* Use Key with event.id to preserve DOM focus during scroll */}
                        <Key
                          each={allDayEventLayouts().filter((l) => l.row < 1)}
                          by={(l) => l.event.id}
                        >
                          {(layout) => {
                            // Check if this chip spans any column with multiple events
                            // Use accessors inside to stay reactive
                            const shouldHide = () => {
                              const width = layout().width;
                              const days = visibleDays();
                              const counts = eventCountsPerDay();
                              const chipStartPx = layout().left;
                              const chipEndPx = layout().left + layout().width;

                              return days.some((day) => {
                                const dayStartPx = day.left;
                                const dayEndPx = day.left + width;
                                const overlaps =
                                  chipStartPx < dayEndPx &&
                                  chipEndPx > dayStartPx;
                                const count =
                                  counts.get(getDateKey(day.date)) ?? 0;
                                return overlaps && count > 1;
                              });
                            };

                            return (
                              <Show when={!shouldHide()}>
                                <AllDayEventChip
                                  event={layout().event}
                                  left={layout().left}
                                  width={layout().width}
                                  row={layout().row}
                                  startsBeforeView={layout().startsBeforeView}
                                  endsAfterView={layout().endsAfterView}
                                />
                              </Show>
                            );
                          }}
                        </Key>

                        {/* "X events" labels for columns with multiple events */}
                        <Key each={visibleDays()} by={(d) => getDateKey(d.date)}>
                          {(day) => {
                            const count = () =>
                              eventCountsPerDay().get(getDateKey(day().date)) ??
                              0;

                            return (
                              <Show when={count() > 1}>
                                <div
                                  class="absolute flex items-center px-1.5 text-xs text-fg-muted font-light cursor-pointer hover:text-fg transition-colors"
                                  style={{
                                    left: "0",
                                    transform: `translateX(${day().left}px)`,
                                    width: `${layout().width}px`,
                                    top: "4px",
                                    height: "var(--grid-all-day-chip-height)",
                                  }}
                                  onClick={toggleAllDayExpanded}
                                  role="button"
                                  tabIndex={0}
                                  aria-label={`${count()} all-day events. Click to expand.`}
                                >
                                  {count()} events
                                </div>
                              </Show>
                            );
                          }}
                        </Key>
                      </>
                    }
                  >
                    {/* When expanded: show all chips */}
                    {/* Use Key with event.id to preserve DOM focus during scroll */}
                    <Key each={allDayEventLayouts()} by={(l) => l.event.id}>
                      {(layout) => (
                        <AllDayEventChip
                          event={layout().event}
                          left={layout().left}
                          width={layout().width}
                          row={layout().row}
                          startsBeforeView={layout().startsBeforeView}
                          endsAfterView={layout().endsAfterView}
                        />
                      )}
                    </Key>
                  </Show>

                  {/* All-day creation placeholder */}
                  <AllDayPlaceholder days={visibleDays()} colWidth={layout().width} row={allDayPlaceholderRow()} />

                  {/* Ghost chip during unfold drag — dashed outline at original position */}
                  <Show when={unfoldGhostLayout()}>
                    {(ghost) => (
                      <div
                        class="absolute rounded pointer-events-none"
                        style={{
                          left: "0",
                          transform: `translateX(${ghost().left}px)`,
                          width: `${ghost().width}px`,
                          top: "4px",
                          height: "var(--grid-all-day-chip-height)",
                          "background-color": `color-mix(in srgb, ${ghost().color} 10%, transparent)`,
                          border: `1px dashed ${ghost().color}`,
                          "border-radius": CHIP_BORDER_RADIUS,
                          opacity: "0.6",
                        }}
                      />
                    )}
                  </Show>
                </div>
              </div>

              {/* Sticky Time Column Body - Sticky Left, below all-day section */}
              <div
                class="bg-surface border-r border-border"
                style={{
                  width: "var(--grid-time-col-width)",
                  "min-width": "var(--grid-time-col-width)",
                  "max-width": "var(--grid-time-col-width)",
                  height: `${TOTAL_HEIGHT}px`,
                  "margin-top": `${Math.max(0, visualAllDayHeight() - ALL_DAY_BASE_HEIGHT)}px`,
                  position: "sticky",
                  left: "0",
                  "z-index": "6",
                  overflow: "hidden",
                  transform: "translateZ(0)",
                  contain: "layout",
                }}
              >
                <div
                  class="relative"
                  style={{
                    height: `${TOTAL_HEIGHT}px`,
                  }}
                >
                  <TimeColumn />
                  <CurrentTimeBadge />
                </div>
              </div>

              {/* Absolute Day Columns */}
              <Key each={visibleDays()} by={(d) => getDateKey(d.date)}>
                {(item) => (
                  <div
                    class="absolute border-l border-border"
                    style={{
                      left: "0",
                      transform: `translateX(${item().left}px)`,
                      width: `${layout().width}px`,
                      height: `${TOTAL_HEIGHT}px`,
                      top: `${MONTH_LABEL_HEIGHT + HEADER_HEIGHT + visualAllDayHeight()}px`,
                      "z-index": "1",
                    }}
                  >
                    <DayColumn date={item().date} />
                  </div>
                )}
              </Key>

              {/* Current Time Line - spans full width at current time position */}
              <div
                style={{
                  position: "absolute",
                  left: "0",
                  top: `${MONTH_LABEL_HEIGHT + HEADER_HEIGHT + visualAllDayHeight()}px`,
                  width: "100%",
                  height: `${TOTAL_HEIGHT}px`,
                  "pointer-events": "none",
                  "z-index": "5",
                }}
              >
                <CurrentTimeLine totalDays={1} visibleDaysCount={1} />
              </div>

              {/* Phantom Snap Track - invisible anchors for scroll snapping (Notion approach) */}
              {/* Renders ~1461 empty divs as stable snap points - must span full height */}
              <Key each={snapTrackIndices()} by={(i) => i}>
                {(dayIndex) => {
                  const date = addDays(anchorDate(), dayIndex());
                  return (
                    <div
                      class="pointer-events-none"
                      style={{
                        position: "absolute",
                        top: "0",
                        left: "0",
                        transform: `translateX(${getDayLeftPosition(dayIndex(), layout().width)}px)`,
                        width: `${layout().width}px`,
                        height: `${contentHeight()}px`,
                        "z-index": "-1",
                        // In 7-day view, only Sundays are snap points so the view
                        // always shows a full Sun–Sat week. Other day counts snap
                        // to every day for flexible scrolling.
                        "scroll-snap-align":
                          visibleDaysCount() === 7 && !isWeekStart(date)
                            ? "none"
                            : "start",
                        "scroll-snap-stop":
                          isWeekStart(date) && visibleDaysCount() >= 7
                            ? "always"
                            : "normal",
                      }}
                    />
                  );
                }}
              </Key>
            </div>
          </div>
        }
      >
        <MonthView />
      </Show>
    </div>
  );
}

export function scrollToToday() {
  setCenterDate(new Date());
}
