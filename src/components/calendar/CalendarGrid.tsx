import { createSignal, onMount, onCleanup, createEffect, createMemo, on, Show } from "solid-js";
import { Key } from "@solid-primitives/keyed";
import { Loader2 } from "lucide-solid";
import { TimeColumn } from "./TimeColumn";
import { DateHeader } from "./DateHeader";
import { DayColumn } from "./DayColumn";
import { CurrentTimeBadge, CurrentTimeLine } from "./CurrentTimeIndicator";
import { addDays, isSameDay, isToday, formatMonthYear, getWeekId } from "../../lib/date-utils";
import { isLoadingWeeks } from "../../stores/events";

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
const HEADER_HEIGHT = 53; // px - matches --grid-header-height
const TIME_COL_WIDTH_FALLBACK = 64; // px - fallback for --grid-time-col-width
const VISIBLE_DAYS_COUNT = 7; // Number of day columns visible at once
const VISIBLE_BUFFER_DAYS = 5; // Extra days to render off-screen for smooth scrolling
const INITIAL_SCROLL_OFFSET_HOURS = 2; // Hours before current time to show on initial load

// Derived dimensions
const TOTAL_HEIGHT = HOURS_PER_DAY * HOUR_HEIGHT;
const CONTENT_HEIGHT = TOTAL_HEIGHT + HEADER_HEIGHT;

// ============================================================================
// Constants - Virtual Scroll Container
// ============================================================================
const CONTAINER_WIDTH = 500000; // Large virtual width for infinite scroll
const CENTER_OFFSET = CONTAINER_WIDTH / 2; // Anchor point in middle

// ============================================================================
// Constants - Scroll Snap
// ============================================================================
const SNAP_TRACK_RANGE = 365; // Days in each direction from anchor for snap points

// ============================================================================
// Constants - Scroll Direction Tracking (for prefetching)
// ============================================================================
const DIRECTION_THRESHOLD_PX = 10; // Minimum movement to register direction change
const DIRECTION_RESET_DELAY_MS = 2000; // Reset to null after idle period

// Initial Reference Date (Anchor)
// All positions are calculated relative to this date being at CENTER_OFFSET
const anchorDate = (() => {
  const today = new Date();
  const d = new Date(today);
  d.setDate(today.getDate() - today.getDay()); // Start with Sunday
  d.setHours(0, 0, 0, 0);
  return d;
})();

// Export signals for external control
// Initialize to anchor (Sunday of current week) for consistent startup
export const [centerDate, setCenterDate] = createSignal(new Date(anchorDate));
export const [displayedMonth, setDisplayedMonth] = createSignal("");
// Flash highlight signal - set this to a date to trigger a flash animation on that day column
export const [flashDate, setFlashDate] = createSignal<Date | null>(null);
// The actual first visible day based on scroll position (updates with daily granularity)
export const [visibleStartDate, setVisibleStartDate] = createSignal(new Date(anchorDate));
// Visible weeks signal - contains 1-2 week IDs depending on whether view spans week boundary
export const [visibleWeeks, setVisibleWeeks] = createSignal<string[]>([]);
// Scroll direction signal for prefetching - null when idle, 'left' (past) or 'right' (future)
export const [scrollDirection, setScrollDirection] = createSignal<'left' | 'right' | null>(null);


export function CalendarGrid() {
  let scrollContainerRef: HTMLDivElement | undefined;
  let isInitialized = false;

  // Track scroll position for virtualization
  const [scrollLeft, setScrollLeft] = createSignal(CENTER_OFFSET);
  const [containerWidth, setContainerWidth] = createSignal(0);

  // Signal to track computed column width for responsive layout
  const [colWidth, setColWidth] = createSignal(120);

  // Disable scroll snap during programmatic scrolls to prevent feedback loops
  const [snapEnabled, setSnapEnabled] = createSignal(true);

  // Track scroll direction for prefetching
  let lastScrollLeft = CENTER_OFFSET;
  let directionResetTimer: ReturnType<typeof setTimeout> | undefined;

  // Get the time column width from CSS variable
  const getTimeColWidth = () => {
    const cssValue = getComputedStyle(document.documentElement).getPropertyValue('--grid-time-col-width');
    return parseInt(cssValue) || TIME_COL_WIDTH_FALLBACK;
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

    const width = availableWidth / VISIBLE_DAYS_COUNT;
    if (width > 0) {
      setColWidth(width);
    }
    return width;
  };

  // Calculate pixel position for a day index relative to anchor
  const getDayLeftPosition = (dayIndex: number, width: number) =>
    CENTER_OFFSET + (dayIndex * width);

  // Calculate visible day range based on scroll position
  const visibleDays = createMemo(() => {
    const width = colWidth();
    const currentScrollLeft = scrollLeft();
    const currentContainerWidth = containerWidth() || window.innerWidth;

    // Calculate day indices relative to anchor (0 = anchor date)
    const startPixel = currentScrollLeft;
    const endPixel = currentScrollLeft + currentContainerWidth;

    const startIndex = Math.floor((startPixel - CENTER_OFFSET) / width) - VISIBLE_BUFFER_DAYS;
    const endIndex = Math.ceil((endPixel - CENTER_OFFSET) / width) + VISIBLE_BUFFER_DAYS;

    const days: { date: Date; left: number }[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      days.push({
        date: addDays(anchorDate, i),
        left: getDayLeftPosition(i, width)
      });
    }

    return days;
  });

  // Snap track: day indices for scroll snapping (Notion approach)
  // Returns indices only - position computed inline to avoid recreating objects on resize
  const snapTrackIndices = createMemo(() => {
    const indices: number[] = [];
    for (let i = -SNAP_TRACK_RANGE; i <= SNAP_TRACK_RANGE; i++) {
      indices.push(i);
    }
    return indices;
  });

  // Calculate day index from scroll position
  // Account for sticky time column - the visible day starts after the time column
  const getDayIndexFromScroll = (scroll: number) => {
    const timeColWidth = getTimeColWidth();
    return Math.round((scroll + timeColWidth - CENTER_OFFSET) / colWidth());
  };

  // Handle scroll events
  const handleScroll = () => {
    if (!scrollContainerRef) return;
    const currentScrollLeft = scrollContainerRef.scrollLeft;
    setScrollLeft(currentScrollLeft);

    // Track scroll direction for prefetching
    // Skip during programmatic scrolls (when snap is disabled) to avoid incorrect direction
    if (snapEnabled()) {
      if (currentScrollLeft > lastScrollLeft + DIRECTION_THRESHOLD_PX) {
        setScrollDirection('right'); // Scrolling toward future
      } else if (currentScrollLeft < lastScrollLeft - DIRECTION_THRESHOLD_PX) {
        setScrollDirection('left'); // Scrolling toward past
      }

      // Reset direction to null after period of no scrolling
      if (directionResetTimer) {
        clearTimeout(directionResetTimer);
      }
      directionResetTimer = setTimeout(() => {
        setScrollDirection(null);
      }, DIRECTION_RESET_DELAY_MS);
    }
    lastScrollLeft = currentScrollLeft;

    const width = colWidth();
    if (width > 0) {
      const dayIndex = getDayIndexFromScroll(currentScrollLeft);
      const currentDate = addDays(anchorDate, dayIndex);

      // Update displayed month if changed
      const newMonth = formatMonthYear(currentDate);
      if (newMonth !== displayedMonth()) {
        setDisplayedMonth(newMonth);
      }

      // Update visible start date for mini-calendar highlighting
      // Note: centerDate is only set externally (e.g., from mini-calendar clicks)
      // to avoid feedback loops with the scroll effect
      if (!isSameDay(currentDate, visibleStartDate())) {
        setVisibleStartDate(currentDate);
      }

      // Update visible weeks - compute week IDs for visible range
      const endDate = addDays(currentDate, VISIBLE_DAYS_COUNT - 1);
      const startWeek = getWeekId(currentDate);
      const endWeek = getWeekId(endDate);

      // Build new weeks array (1 or 2 weeks depending on boundary crossing)
      const newWeeks = startWeek === endWeek ? [startWeek] : [startWeek, endWeek];

      // Only update if weeks actually changed
      const currentWeeks = visibleWeeks();
      if (newWeeks.length !== currentWeeks.length ||
          newWeeks.some((w, i) => w !== currentWeeks[i])) {
        setVisibleWeeks(newWeeks);
      }
    }
  };

  // Virtual Scroll to a specific date
  const scrollToDate = (date: Date) => {
    if (!scrollContainerRef) return;

    // Disable snap during programmatic scroll to prevent feedback loop
    setSnapEnabled(false);

    // Normalize to midnight to avoid time component affecting day calculation
    const normalizedDate = new Date(date);
    normalizedDate.setHours(0, 0, 0, 0);

    // Calculate difference in days from anchor
    const diffTime = normalizedDate.getTime() - anchorDate.getTime();
    // Use Math.round to handle DST issues (difference should be roughly integer days)
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    // Account for sticky time column - position the target day right after the time column
    const timeColWidth = getTimeColWidth();
    const targetScrollLeft = CENTER_OFFSET + (diffDays * colWidth()) - timeColWidth;

    scrollContainerRef.scrollLeft = targetScrollLeft;

    // Re-enable snap after scroll settles
    requestAnimationFrame(() => {
      setSnapEnabled(true);
    });
  };

  // Handle resize
  const handleResize = () => {
    if (!scrollContainerRef) return;
    // Remember the date we were looking at
    const currentLeftDate = visibleStartDate();

    getColumnWidth(); // Update width

    // Restore scroll position to keep that date at left
    scrollToDate(currentLeftDate);
  };

  // Initialize on mount
  onMount(() => {
    // Initial setup
    getColumnWidth();

    // Set initial scroll to "Today" (Sunday of current week)
    requestAnimationFrame(() => {
      if (scrollContainerRef) {
        // Scroll to Today (or initial CenterDate if set)
        scrollToDate(centerDate());

        // Vertical scroll to show current time with some context above
        const currentHour = new Date().getHours();
        const scrollPosition = Math.max(0, (currentHour - INITIAL_SCROLL_OFFSET_HOURS) * HOUR_HEIGHT);
        scrollContainerRef.scrollTop = scrollPosition;

        // Force initial update of signals
        handleScroll();

        isInitialized = true;
      }
    });

    // Resize Observer
    if (scrollContainerRef) {
      const resizeObserver = new ResizeObserver((entries) => {
        if (entries[0]?.contentRect.width > 0) {
          getColumnWidth();
          if (isInitialized) {
            // Stay on current date during resize
            scrollToDate(visibleStartDate());
          }
        }
      });
      resizeObserver.observe(scrollContainerRef);
      onCleanup(() => resizeObserver.disconnect());
    }

    // Keyboard handlers
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        const activeEl = document.activeElement as HTMLElement | null;
        const eventWrapper = activeEl?.closest("[data-event-id]") as HTMLElement | null;
        if (eventWrapper && (eventWrapper as any).triggerBurn) {
          e.preventDefault();
          (eventWrapper as any).triggerBurn();
        }
      } else if (e.key === "Escape") {
        (document.activeElement as HTMLElement | null)?.blur();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));

    // Cleanup direction reset timer
    onCleanup(() => {
      if (directionResetTimer) {
        clearTimeout(directionResetTimer);
      }
    });
  });

  // React to external centerDate changes (e.g. from Mini Calendar)
  // Using on() with defer to only scroll when centerDate actually changes,
  // not on initial mount (handled by onMount) or when comparing to visibleStartDate
  createEffect(
    on(centerDate, (target) => {
      scrollToDate(target);
    }, { defer: true })
  );

  return (
    <div class="flex-1 flex flex-col max-h-full overflow-hidden">
      {/* Month/Year indicator - outside scroll container */}
      <div class="px-4 py-2 bg-white border-b border-[#e8e8e8] shrink-0 flex items-center justify-between">
        <span class="text-lg font-medium text-[#37352f]">{displayedMonth()}</span>
        <Show when={isLoadingWeeks()}>
          <Loader2
            size={16}
            class="text-[#91918e] animate-spin"
            aria-label="Loading events"
          />
        </Show>
      </div>

      {/* ONE Main Scroll Container */}
      <div
        ref={scrollContainerRef}
        class="flex-1 overflow-auto overscroll-none"
        style={{
          "position": "relative",
          "scroll-snap-type": snapEnabled() ? "x mandatory" : "none",
          "scroll-padding-left": "var(--grid-time-col-width)",
        }}
        onScroll={handleScroll}
      >
        {/* Inner Virtual Container - Extremely Wide */}
        <div style={{ width: `${CONTAINER_WIDTH}px`, height: `${CONTENT_HEIGHT}px`, position: "relative" }}>

          {/* Sticky Header Row */}
          <div
            class="flex bg-white border-b border-[#e8e8e8]"
            style={{
              position: "sticky",
              top: "0",
              "z-index": "10",
              height: `${HEADER_HEIGHT}px`,
              width: "100%",
            }}
          >
            {/* Sticky Time Column Header - Sticky Left */}
            <div
              class="bg-white border-r border-[#e8e8e8]"
              style={{
                width: "var(--grid-time-col-width)",
                height: `${HEADER_HEIGHT}px`,
                "flex-shrink": "0",
                position: "sticky",
                left: "0",
                "z-index": "20", // Higher than date headers
              }}
            />

            {/* Absolute Date Headers */}
            <Key each={visibleDays()} by={(d) => getDateKey(d.date)}>
              {(item) => (
                <div
                  class="absolute border-r border-[#e8e8e8] bg-white"
                  style={{
                    left: `${item().left}px`,
                    width: `${colWidth()}px`,
                    height: `${HEADER_HEIGHT}px`,
                    top: 0
                  }}
                >
                  <DateHeader date={item().date} isToday={isToday(item().date)} />
                </div>
              )}
            </Key>
          </div>

          {/* Sticky Time Column Body - Sticky Left */}
          <div
            class="bg-white border-r border-[#e8e8e8]"
            style={{
              width: "var(--grid-time-col-width)",
              height: `${TOTAL_HEIGHT}px`,
              position: "sticky",
              left: "0",
              "z-index": "15",
            }}
          >
            <div class="relative" style={{ height: `${TOTAL_HEIGHT}px` }}>
              <TimeColumn />
              <CurrentTimeBadge />
            </div>
          </div>

          {/* Absolute Day Columns */}
          <Key each={visibleDays()} by={(d) => getDateKey(d.date)}>
            {(item) => (
              <div
                class="absolute border-r border-[#e8e8e8]"
                style={{
                  left: `${item().left}px`,
                  width: `${colWidth()}px`,
                  height: `${TOTAL_HEIGHT}px`,
                  top: `${HEADER_HEIGHT}px`, // Below header
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
              top: `${HEADER_HEIGHT}px`,
              width: "100%",
              height: `${TOTAL_HEIGHT}px`,
              "pointer-events": "none",
              "z-index": "5"
            }}
          >
            <CurrentTimeLine totalDays={1} visibleDaysCount={1} />
          </div>

          {/* Phantom Snap Track - invisible anchors for scroll snapping (Notion approach) */}
          {/* Renders 731 empty divs as stable snap points - must span full height */}
          <Key each={snapTrackIndices()} by={(i) => i}>
            {(dayIndex) => {
              const date = addDays(anchorDate, dayIndex());
              return (
                <div
                  class="pointer-events-none"
                  style={{
                    position: "absolute",
                    top: "0",
                    left: `${getDayLeftPosition(dayIndex(), colWidth())}px`,
                    width: `${colWidth()}px`,
                    height: `${CONTENT_HEIGHT}px`,
                    "z-index": "-1",
                    "scroll-snap-align": "start",
                    "scroll-snap-stop": isWeekStart(date) ? "always" : "normal",
                  }}
                />
              );
            }}
          </Key>

        </div>
      </div>
    </div>
  );
}

export function scrollToToday() {
  setCenterDate(new Date());
}
