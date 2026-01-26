import { createSignal, onMount, onCleanup, createEffect, createMemo } from "solid-js";
import { Key } from "@solid-primitives/keyed";
import { TimeColumn } from "./TimeColumn";
import { DateHeader } from "./DateHeader";
import { DayColumn } from "./DayColumn";
import { CurrentTimeBadge, CurrentTimeLine } from "./CurrentTimeIndicator";
import { addDays, getSundayOfWeek, isSameDay, formatMonthYear } from "../../lib/date-utils";

// Helper to create stable date key for <Key> component
const getDateKey = (date: Date): string =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

// Sliding window: small buffer since we're not virtualizing
const BUFFER_DAYS = 7; // Days on each side
const VISIBLE_DAYS = 7;
const TOTAL_DAYS = BUFFER_DAYS * 2 + VISIBLE_DAYS; // 21 days total
const TOTAL_HEIGHT = 24 * 48; // 24 hours × 48px
const HEADER_HEIGHT = 40; // px

// Get Sunday of the current week for initial view
const initialSunday = (() => {
  const today = new Date();
  const result = new Date(today);
  result.setDate(today.getDate() - today.getDay());
  return result;
})();

// Export signals for external control
export const [centerDate, setCenterDate] = createSignal(initialSunday);
export const [displayedMonth, setDisplayedMonth] = createSignal("");
// Flash highlight signal - set this to a date to trigger a flash animation on that day column
export const [flashDate, setFlashDate] = createSignal<Date | null>(null);
// The actual first visible day based on scroll position (updates with daily granularity)
export const [visibleStartDate, setVisibleStartDate] = createSignal(initialSunday);


export function CalendarGrid() {
  let scrollContainerRef: HTMLDivElement | undefined;
  let isShifting = false;
  let isInitialized = false;

  // Track which day is at left edge (for preserving view on resize)
  let leftmostDayIndex = BUFFER_DAYS;

  // Signal to track computed column width for responsive layout
  const [colWidth, setColWidth] = createSignal(120);

  // Generate sliding window of dates centered around centerDate
  const visibleDays = createMemo(() => {
    const center = centerDate();
    const days: Date[] = [];
    const startDate = addDays(center, -BUFFER_DAYS - Math.floor(VISIBLE_DAYS / 2));

    for (let i = 0; i < TOTAL_DAYS; i++) {
      days.push(addDays(startDate, i));
    }
    return days;
  });

  // Get the time column width from CSS variable
  const getTimeColWidth = () => {
    return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--grid-time-col-width')) || 64;
  };

  // Get current column width based on visible area and update signal
  const getColumnWidth = () => {
    if (!scrollContainerRef) return colWidth();
    // Don't update width during buffer shift - use captured value
    if (isShifting) return colWidth();

    const containerWidth = scrollContainerRef.clientWidth;
    // Guard against container not being laid out yet
    if (containerWidth <= 0) return colWidth();

    const timeColWidth = getTimeColWidth();
    const availableWidth = containerWidth - timeColWidth;
    // Ensure we have positive available width
    if (availableWidth <= 0) return colWidth();

    const width = availableWidth / VISIBLE_DAYS;
    // Always update signal with valid width
    if (width > 0) {
      setColWidth(width);
    }
    return width;
  };

  // Update displayed month based on scroll position
  const updateDisplayedMonth = () => {
    if (!scrollContainerRef) return;

    const colWidth = getColumnWidth();
    const scrollLeft = scrollContainerRef.scrollLeft;
    const leftmostIndex = Math.round(scrollLeft / colWidth);
    const days = visibleDays();

    if (days[leftmostIndex]) {
      const newMonth = formatMonthYear(days[leftmostIndex]);
      if (newMonth !== displayedMonth()) {
        setDisplayedMonth(newMonth);
      }
    }
  };

  // Check if we need to shift the sliding window
  const checkAndShiftBuffer = () => {
    if (!scrollContainerRef || isShifting) return;

    const colWidth = getColumnWidth();
    const scrollLeft = scrollContainerRef.scrollLeft;
    const dayIndex = Math.round(scrollLeft / colWidth);
    const threshold = 2; // Shift when within 2 columns of edge

    if (dayIndex <= threshold) {
      shiftBuffer(-7); // Shift window left (earlier dates)
    } else if (dayIndex >= TOTAL_DAYS - VISIBLE_DAYS - threshold) {
      shiftBuffer(7); // Shift window right (later dates)
    }
  };

  // Shift the sliding window
  const shiftBuffer = (days: number) => {
    if (!scrollContainerRef || isShifting) return;

    isShifting = true;

    // Capture current column width (don't let it change during shift)
    const currentColWidth = colWidth();
    const currentScrollLeft = scrollContainerRef.scrollLeft;
    const adjustment = days * currentColWidth;
    const newScrollLeft = currentScrollLeft - adjustment;

    // Temporarily disable scroll-snap to prevent fighting with our scroll adjustment
    scrollContainerRef.style.scrollSnapType = "none";

    // Update center date (shifts the window) - SolidJS updates DOM synchronously
    setCenterDate(addDays(centerDate(), days));

    // Adjust scroll position immediately after DOM update (no frame delay)
    scrollContainerRef.scrollLeft = newScrollLeft;

    // Re-enable scroll-snap and allow next shift after a short delay
    setTimeout(() => {
      if (scrollContainerRef) {
        scrollContainerRef.style.scrollSnapType = "x mandatory";
      }
      isShifting = false;
    }, 100);
  };

  // Handle scroll - browser handles sync via sticky, we just track state
  const handleScroll = () => {
    if (!scrollContainerRef) return;

    const scrollLeft = scrollContainerRef.scrollLeft;

    // Track which day is at left edge - only update signals when day actually changes
    const colWidth = getColumnWidth();
    if (colWidth > 0) {
      const newLeftmostIndex = Math.round(scrollLeft / colWidth);
      if (newLeftmostIndex !== leftmostDayIndex) {
        leftmostDayIndex = newLeftmostIndex;
        // Update the visible start date signal for mini-calendar sync
        const days = visibleDays();
        if (days[leftmostDayIndex]) {
          setVisibleStartDate(days[leftmostDayIndex]);
        }
        // Update month display only when day changes
        updateDisplayedMonth();
      }
    }

    // Check buffer shift (doesn't trigger signals unless threshold reached)
    if (!isShifting) {
      checkAndShiftBuffer();
    }
  };

  // Handle resize - preserve visible days
  const handleResize = () => {
    if (!scrollContainerRef) return;

    const colWidth = getColumnWidth();
    if (colWidth <= 0) return;

    // Scroll to keep the same day at left edge
    const newScrollLeft = leftmostDayIndex * colWidth;
    scrollContainerRef.scrollLeft = newScrollLeft;
  };

  // Handle keyboard events for event deletion
  const handleKeyDown = (e: KeyboardEvent) => {
    const activeEl = document.activeElement as HTMLElement | null;
    const eventWrapper = activeEl?.closest("[data-event-id]") as HTMLElement | null;
    if (!eventWrapper) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if ((eventWrapper as any).triggerBurn) {
        (eventWrapper as any).triggerBurn();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      activeEl?.blur();
    }
  };

  // Initialize on mount
  onMount(() => {
    setDisplayedMonth(formatMonthYear(centerDate()));

    // Set up keyboard listener for delete/escape
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));

    // Set up ResizeObserver to handle resize events (after initialization)
    if (scrollContainerRef) {
      const resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry && entry.contentRect.width > 0) {
          // Always update column width
          getColumnWidth();
          // Only adjust scroll position after initial setup is complete
          if (isInitialized) {
            handleResize();
          }
        }
      });
      resizeObserver.observe(scrollContainerRef);
      onCleanup(() => resizeObserver.disconnect());
    }

    // Initialize scroll position after layout is stable
    // Use double-rAF to ensure layout has been computed
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (scrollContainerRef) {
          // Calculate column width now that layout is stable
          const calculatedColWidth = getColumnWidth();
          const days = visibleDays();
          const sunday = getSundayOfWeek(new Date());
          const sundayIndex = days.findIndex((d) => isSameDay(d, sunday));

          if (sundayIndex !== -1) {
            leftmostDayIndex = sundayIndex;
            const initialScrollLeft = sundayIndex * calculatedColWidth;
            scrollContainerRef.scrollLeft = initialScrollLeft;
            // Initialize visible start date
            setVisibleStartDate(days[sundayIndex]);
          }

          // Scroll vertically to current time
          const now = new Date();
          const hours = now.getHours();
          const scrollPosition = Math.max(0, (hours - 2) * 48);
          scrollContainerRef.scrollTop = scrollPosition;

          updateDisplayedMonth();

          // Mark as initialized after scroll setup is complete
          isInitialized = true;
        }
      });
    });
  });

  // React to external centerDate changes (e.g., "Today" button)
  createEffect(() => {
    const center = centerDate();
    if (isShifting) return;

    requestAnimationFrame(() => {
      if (scrollContainerRef && !isShifting) {
        const colWidth = getColumnWidth();
        const days = visibleDays();
        const centerIndex = days.findIndex((d) => isSameDay(d, center));

        if (centerIndex !== -1) {
          const newScrollLeft = centerIndex * colWidth;
          scrollContainerRef.scrollLeft = newScrollLeft;
          // Update visible start date for mini-calendar sync
          setVisibleStartDate(days[centerIndex]);
          updateDisplayedMonth();
        }
      }
    });
  });

  return (
    <div class="flex-1 flex flex-col max-h-full overflow-hidden">
      {/* Month/Year indicator - outside scroll container */}
      <div class="px-4 py-2 bg-white border-b border-[#e8e8e8] shrink-0">
        <span class="text-lg font-medium text-[#37352f]">{displayedMonth()}</span>
      </div>

      {/* ONE Main Scroll Container - handles both X and Y scrolling */}
      <div
        ref={scrollContainerRef}
        class="flex-1 overflow-auto overscroll-none"
        style={{ "scroll-snap-type": "x mandatory" }}
        onScroll={handleScroll}
      >
        {/* Header Row - sticky at top, stretches to full content width */}
        <div
          class="flex bg-white border-b border-[#e8e8e8]"
          style={{
            position: "sticky",
            top: "0",
            "z-index": "10",
            height: `${HEADER_HEIGHT}px`,
            width: "max-content",
          }}
        >
          {/* Time column corner - sticky left AND top */}
          <div
            class="bg-white border-r border-[#e8e8e8]"
            style={{
              width: "var(--grid-time-col-width)",
              "flex-shrink": "0",
              position: "sticky",
              left: "0",
              "z-index": "11",
            }}
          />
          {/* Date header cells */}
          <Key each={visibleDays()} by={getDateKey}>
            {(day) => (
              <div
                class="border-r border-[#e8e8e8]"
                style={{
                  width: `${colWidth()}px`,
                  "flex-shrink": "0",
                  "scroll-snap-align": "start",
                }}
              >
                <DateHeader date={day()} />
              </div>
            )}
          </Key>
        </div>

        {/* Body Content - positioned relative for events */}
        <div style={{ position: "relative", width: "max-content" }}>
          <div class="flex" style={{ height: `${TOTAL_HEIGHT}px` }}>
            {/* Time column - sticky left */}
            <div
              class="bg-white border-r border-[#e8e8e8]"
              style={{
                width: "var(--grid-time-col-width)",
                "flex-shrink": "0",
                position: "sticky",
                left: "0",
                "z-index": "5",
              }}
            >
              <div class="relative" style={{ height: `${TOTAL_HEIGHT}px` }}>
                <TimeColumn />
                <CurrentTimeBadge />
              </div>
            </div>

            {/* Day columns */}
            <Key each={visibleDays()} by={getDateKey}>
              {(day) => (
                <div
                  class="border-r border-[#e8e8e8]"
                  style={{
                    width: `${colWidth()}px`,
                    height: `${TOTAL_HEIGHT}px`,
                    "flex-shrink": "0",
                    "scroll-snap-align": "start",
                  }}
                >
                  <DayColumn date={day()} />
                </div>
              )}
            </Key>

            {/* Current time indicator line spanning all columns */}
            <CurrentTimeLine
              totalDays={TOTAL_DAYS}
              visibleDaysCount={VISIBLE_DAYS}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function scrollToToday() {
  setCenterDate(new Date());
}
