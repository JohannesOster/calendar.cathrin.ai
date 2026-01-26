import { createSignal, onMount, onCleanup, createEffect, createMemo, batch } from "solid-js";
import { Key } from "@solid-primitives/keyed";
import { TimeColumn } from "./TimeColumn";
import { DateHeader } from "./DateHeader";
import { DayColumn } from "./DayColumn";
import { CurrentTimeBadge, CurrentTimeLine } from "./CurrentTimeIndicator";
import { addDays, getSundayOfWeek, isSameDay, formatMonthYear } from "../../lib/date-utils";
import { refreshEvents } from "../../stores/events";

// Helper to create stable date key for <Key> component
const getDateKey = (date: Date): string =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

// Virtual Container Configuration
const CONTAINER_WIDTH = 500000; // Large virtual width
const CENTER_OFFSET = CONTAINER_WIDTH / 2; // Start in middle "Today"
const VISIBLE_BUFFER_DAYS = 5; // Extra days to render off-screen

// Dimensions
const TOTAL_HEIGHT = 24 * 48; // 24 hours × 48px
const HEADER_HEIGHT = 40; // px

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
export const [centerDate, setCenterDate] = createSignal(new Date());
export const [displayedMonth, setDisplayedMonth] = createSignal("");
// Flash highlight signal - set this to a date to trigger a flash animation on that day column
export const [flashDate, setFlashDate] = createSignal<Date | null>(null);
// The actual first visible day based on scroll position (updates with daily granularity)
export const [visibleStartDate, setVisibleStartDate] = createSignal(new Date());


export function CalendarGrid() {
  let scrollContainerRef: HTMLDivElement | undefined;
  let isInitialized = false;

  // Track loaded range to avoid redundant fetches
  // Initial window is -7 to +30 days (matches events.ts default)
  const initialStart = new Date();
  initialStart.setDate(initialStart.getDate() - 7);
  const initialEnd = new Date();
  initialEnd.setDate(initialEnd.getDate() + 30);

  let loadedStart = initialStart;
  let loadedEnd = initialEnd;

  // Track scroll position for virtualization
  const [scrollLeft, setScrollLeft] = createSignal(CENTER_OFFSET);
  const [containerWidth, setContainerWidth] = createSignal(0);

  // Signal to track computed column width for responsive layout
  const [colWidth, setColWidth] = createSignal(120);

  // Get the time column width from CSS variable
  const getTimeColWidth = () => {
    return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--grid-time-col-width')) || 64;
  };

  // Get current column width based on visible area and update signal
  const getColumnWidth = () => {
    if (!scrollContainerRef) return colWidth();

    const cw = scrollContainerRef.clientWidth;
    if (cw <= 0) return colWidth();
    setContainerWidth(cw); // Track container width for virtualization

    const timeColWidth = getTimeColWidth();
    const availableWidth = cw - timeColWidth;
    if (availableWidth <= 0) return colWidth();

    // Default to displaying 7 days
    const width = availableWidth / 7;
    if (width > 0) {
      setColWidth(width);
    }
    return width;
  };

  // Calculate visible day range based on scroll position
  const visibleDays = createMemo(() => {
    const width = colWidth();
    const sLeft = scrollLeft();
    const cWidth = containerWidth() || window.innerWidth; // Fallback if not measured yet

    // Calculate indices relative to anchor (0 = anchor date)
    // We want to render: floor(start) - buffer  TO  ceil(end) + buffer
    const startPixel = sLeft;
    const endPixel = sLeft + cWidth;

    // Adjust for the fact that pixel 0 is actually CENTER_OFFSET
    // A pixel at P corresponds to offset (P - CENTER_OFFSET)

    const startIndex = Math.floor((startPixel - CENTER_OFFSET) / width) - VISIBLE_BUFFER_DAYS;
    const endIndex = Math.ceil((endPixel - CENTER_OFFSET) / width) + VISIBLE_BUFFER_DAYS;

    const days: { date: Date; left: number }[] = [];

    for (let i = startIndex; i <= endIndex; i++) {
      days.push({
        date: addDays(anchorDate, i),
        left: CENTER_OFFSET + (i * width)
      });
    }

    return days;
  });

  // Calculate day index from scroll position
  const getDayIndexFromScroll = (scroll: number) => {
    return Math.round((scroll - CENTER_OFFSET) / colWidth());
  };

  // Handle scroll events
  const handleScroll = () => {
    if (!scrollContainerRef) return;
    const currentScrollLeft = scrollContainerRef.scrollLeft;
    setScrollLeft(currentScrollLeft);

    const width = colWidth();
    if (width > 0) {
      const dayIndex = getDayIndexFromScroll(currentScrollLeft);
      const currentDate = addDays(anchorDate, dayIndex);

      // Update displayed month if changed
      const newMonth = formatMonthYear(currentDate);
      if (newMonth !== displayedMonth()) {
        setDisplayedMonth(newMonth);
      }

      // Update centralized center date (approximate center of view)
      // Actually centerDate usually means "focused date" or "top-left visible date" depending on context
      // Let's stick to "left-most visible date" for consistency with previous behavior
      if (!isSameDay(currentDate, visibleStartDate())) {
        batch(() => {
          setVisibleStartDate(currentDate);
          setCenterDate(currentDate); // Keep centerDate in sync for MiniCalendar highlights
        });
        checkAndFetchEvents(currentDate);
      }
    }
  };

  // Dynamic Event Fetching
  const checkAndFetchEvents = (visibleStart: Date) => {
    const FETCH_THRESHOLD_DAYS = 14;
    const FETCH_CHUNK_DAYS = 30;

    const distToStart = (visibleStart.getTime() - loadedStart.getTime()) / (1000 * 60 * 60 * 24);
    if (distToStart < FETCH_THRESHOLD_DAYS) {
      const newStart = addDays(loadedStart, -FETCH_CHUNK_DAYS);
      const window = { start: newStart, end: loadedStart };
      loadedStart = newStart;
      refreshEvents(window);
    }

    const visibleEnd = addDays(visibleStart, 7);
    const distToEnd = (loadedEnd.getTime() - visibleEnd.getTime()) / (1000 * 60 * 60 * 24);
    if (distToEnd < FETCH_THRESHOLD_DAYS) {
      const newEnd = addDays(loadedEnd, FETCH_CHUNK_DAYS);
      const window = { start: loadedEnd, end: newEnd };
      loadedEnd = newEnd;
      refreshEvents(window);
    }
  };

  // Virtual Scroll to a specific date
  const scrollToDate = (date: Date) => {
    if (!scrollContainerRef) return;

    // Calculate difference in days from anchor
    const diffTime = date.getTime() - anchorDate.getTime();
    // Use Math.round to handle DST issues (difference should be roughly integer days)
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    const targetScrollLeft = CENTER_OFFSET + (diffDays * colWidth());

    scrollContainerRef.scrollLeft = targetScrollLeft;
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

        // Vertical scroll
        const now = new Date();
        const hours = now.getHours();
        const scrollPosition = Math.max(0, (hours - 2) * 48);
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
  });

  // React to external centerDate changes (e.g. from Mini Calendar)
  createEffect(() => {
    const target = centerDate();
    // If target is significantly different from what we are showing, scroll to it
    // (Check is sameDay to avoid fighting with scroll handler)
    if (!isSameDay(target, visibleStartDate())) {
      scrollToDate(target);
    }
  });

  return (
    <div class="flex-1 flex flex-col max-h-full overflow-hidden">
      {/* Month/Year indicator - outside scroll container */}
      <div class="px-4 py-2 bg-white border-b border-[#e8e8e8] shrink-0">
        <span class="text-lg font-medium text-[#37352f]">{displayedMonth()}</span>
      </div>

      {/* ONE Main Scroll Container */}
      <div
        ref={scrollContainerRef}
        class="flex-1 overflow-auto overscroll-none"
        style={{
          "position": "relative",
          // Since we use absolute positioning for children, snapping is tricky.
          // But we can snap to the container grid interval if we want.
          // "scroll-snap-type": "x mandatory", 
          // Snapping is hard with virtual absolute container because snap points are infinite.
          // Let's rely on manual snapping or just smooth scrolling for now as requested ("No complex scroll correction")
          // Actually user asked for "Infinite Expanding Container" and "Sticky"
        }}
        onScroll={handleScroll}
      >
        {/* Inner Virtual Container - Extremely Wide */}
        <div style={{ width: `${CONTAINER_WIDTH}px`, height: `${TOTAL_HEIGHT + HEADER_HEIGHT}px`, position: "relative" }}>

          {/* Sticky Header Row */}
          <div
            class="flex bg-white border-b border-[#e8e8e8]"
            style={{
              position: "sticky",
              top: "0",
              "z-index": "10",
              height: `${HEADER_HEIGHT}px`,
              width: "100%", // Header spans full virtual width? No, it just needs to contain the absolute children.
              // Actually, header itself should probably just be a container for absolute adjustments?
              // Or better: The container is relative. We can put absolute headers in it.
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
                  <DateHeader date={item().date} />
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
              float: "left", // Force it to sit nicely? No, sticky works in flow.
              // Since parent is "relative" block, this sticky div is just one child.
              // The absolute day columns are siblings.
              // We need to coordinate vertical position.
              "margin-top": "0px"
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

          {/* Current Time Line - Absolute */}
          {/* This needs to span the visible area or be absolute relative to Today's column? 
               The component <CurrentTimeLine> usually draws a line across the grid. 
               We should probably re-implement it or just position it absolutely over the whole container? 
               Ideally it should only be on "Today".
               Re-checking usage: It was spanning all columns.
               For an infinite grid, a line spanning 500,000px is bad.
               Let's render it only for the visible days or just rely on Today's column having a marker?
               Actually DayColumn doesn't have the line.
               Let's update CurrentTimeLine to be just one line across the viewport?
               If we position it sticky left, it moves with scroll? No.
               
               Let's make CurrentTimeLine fixed relative to viewport or spanning the visible area.
               Simpler: Just put it in a fixed overlay?
               
               For now, let's omit the generic "Line across everything" and trust the Badge.
               Or put it inside DayColumn for "Today" specifically? 
               Original code: <CurrentTimeLine totalDays={TOTAL_DAYS} visibleDaysCount={VISIBLE_DAYS} />
               It was using CSS grid/flex to span.
            */}
          <div
            style={{
              position: "absolute",
              left: "0",
              top: `${HEADER_HEIGHT}px`,
              width: "100%", // Spans entire virtual width
              height: `${TOTAL_HEIGHT}px`,
              "pointer-events": "none",
              "z-index": "5"
            }}
          >
            <CurrentTimeLine
              totalDays={1} // Dummy
              visibleDaysCount={1} // Dummy
            />
            {/* Note: CurrentTimeLine implementation might need adjustment to work in this container, 
                     but since it's likely just a "top: X%" div, it might work if width is 100%. 
                  */}
          </div>

        </div>
      </div>
    </div>
  );
}

export function scrollToToday() {
  setCenterDate(new Date());
}
