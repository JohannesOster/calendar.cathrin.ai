import { createSignal, createMemo, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import { Key } from "@solid-primitives/keyed";
import { MonthDayCell, type DayInfo } from "./MonthDayCell";
import { visibleStartDate, setVisibleStartDate, setDisplayedMonth, centerDate, flashDate, setMonthVisibleWeekIds } from "../CalendarGrid";
import { addDays, getWeekId, isSameDay } from "../../../lib/date-utils";

// ============================================================================
// Constants - Grid Dimensions
// ============================================================================
const WEEK_ROW_HEIGHT = 120; // px per week row
const WEEKDAY_HEADER_HEIGHT = 32; // px for Sun-Sat header
const VISIBLE_BUFFER_WEEKS = 3; // Extra weeks to render off-screen

// ============================================================================
// Constants - Virtual Scroll Container
// ============================================================================
const CONTAINER_HEIGHT = 500000; // Large virtual height for infinite scroll
const CENTER_OFFSET = CONTAINER_HEIGHT / 2; // Anchor point in middle

// ============================================================================
// Constants - Snap Track
// ============================================================================
const SNAP_TRACK_WEEKS = 260; // ~5 years in each direction (52 weeks/year)

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Anchor date - Sunday of current week (same as week view)
const anchorDate = (() => {
  const today = new Date();
  const d = new Date(today);
  d.setDate(today.getDate() - today.getDay()); // Start with Sunday
  d.setHours(0, 0, 0, 0);
  console.log('[MonthView] anchorDate:', d.toISOString());
  return d;
})();

// Helper to get week index from date (relative to anchor)
const getWeekIndex = (date: Date): number => {
  const normalizedDate = new Date(date);
  normalizedDate.setHours(0, 0, 0, 0);
  const diffTime = normalizedDate.getTime() - anchorDate.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7);
};

// Helper to get Sunday of a week by index
const getWeekStartDate = (weekIndex: number): Date => {
  return addDays(anchorDate, weekIndex * 7);
};

// Helper to check if a week is the first week of a month
const isFirstWeekOfMonth = (weekStartDate: Date): boolean => {
  // Check if any day in this week is the 1st of a month
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStartDate, i);
    if (day.getDate() === 1) return true;
  }
  return false;
};

// Helper to get month label for a week (if it's the first week)
const getMonthLabel = (weekStartDate: Date): string | null => {
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStartDate, i);
    if (day.getDate() === 1) {
      const month = day.toLocaleDateString("en-US", { month: "long" });
      const year = day.getFullYear();
      return `${month} ${year}`;
    }
  }
  return null;
};

// Get stable key for a week
const getWeekKey = (weekIndex: number): string => `week-${weekIndex}`;

export function MonthView() {
  let scrollContainerRef: HTMLDivElement | undefined;
  const [isInitialized, setIsInitialized] = createSignal(false);

  // Track scroll position for virtualization
  const [scrollTop, setScrollTop] = createSignal(CENTER_OFFSET);
  const [containerHeight, setContainerHeight] = createSignal(0);

  // Disable scroll snap during programmatic scrolls
  const [snapEnabled, setSnapEnabled] = createSignal(true);

  // Calculate visible weeks based on scroll position
  const visibleWeeks = createMemo(() => {
    const currentScrollTop = scrollTop();
    const currentContainerHeight = containerHeight() || window.innerHeight;

    // Calculate week indices relative to anchor
    const startPixel = currentScrollTop;
    const endPixel = currentScrollTop + currentContainerHeight;

    const startIndex = Math.floor((startPixel - CENTER_OFFSET) / WEEK_ROW_HEIGHT) - VISIBLE_BUFFER_WEEKS;
    const endIndex = Math.ceil((endPixel - CENTER_OFFSET) / WEEK_ROW_HEIGHT) + VISIBLE_BUFFER_WEEKS;

    const weeks: { weekIndex: number; top: number; days: DayInfo[]; monthLabel: string | null }[] = [];

    for (let i = startIndex; i <= endIndex; i++) {
      const weekStartDate = getWeekStartDate(i);
      const days: DayInfo[] = [];

      for (let d = 0; d < 7; d++) {
        const date = addDays(weekStartDate, d);
        days.push({
          day: date.getDate(),
          date,
          isCurrentMonth: true, // We'll handle month styling differently in infinite view
        });
      }

      weeks.push({
        weekIndex: i,
        top: CENTER_OFFSET + (i * WEEK_ROW_HEIGHT),
        days,
        monthLabel: getMonthLabel(weekStartDate),
      });
    }

    return weeks;
  });

  // Snap track indices for scroll snapping
  const snapTrackIndices = createMemo(() => {
    const indices: number[] = [];
    for (let i = -SNAP_TRACK_WEEKS; i <= SNAP_TRACK_WEEKS; i++) {
      indices.push(i);
    }
    return indices;
  });

  // Get week index from scroll position
  const getWeekIndexFromScroll = (scroll: number): number => {
    return Math.round((scroll - CENTER_OFFSET) / WEEK_ROW_HEIGHT);
  };

  // Compute visible week IDs (ISO format) for the ~6 weeks visible in viewport
  // This is used by the events store to know which weeks to fetch
  const computedWeekIds = createMemo(() => {
    const currentScrollTop = scrollTop();
    const currentContainerHeight = containerHeight() || window.innerHeight;

    // Calculate which weeks are in the viewport (no buffer - just the visible area)
    const startPixel = currentScrollTop;
    const endPixel = currentScrollTop + currentContainerHeight;

    const startIndex = Math.floor((startPixel - CENTER_OFFSET) / WEEK_ROW_HEIGHT);
    const endIndex = Math.ceil((endPixel - CENTER_OFFSET) / WEEK_ROW_HEIGHT);

    const weekIds: string[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      const weekStartDate = getWeekStartDate(i);
      // Use Wednesday (mid-week) to get the correct ISO week ID
      // Sunday is the last day of an ISO week, so getWeekId(Sunday) returns the previous week
      const midWeekDate = addDays(weekStartDate, 3);
      weekIds.push(getWeekId(midWeekDate));
    }

    return weekIds;
  });

  // Sync computed week IDs to the shared signal for event fetching
  // Only sync after initialized to prevent wrong weeks from being set
  createEffect(() => {
    const weekIds = computedWeekIds();
    if (!isInitialized()) {
      console.log('[MonthView] Skipping monthVisibleWeekIds sync - not initialized');
      return;
    }
    console.log('[MonthView] Setting monthVisibleWeekIds:', weekIds);
    setMonthVisibleWeekIds(weekIds);
  });

  // Compute the month/year label for the header
  // Format: "January 2025" (single month visible), "January – February 2025" (same year),
  // or "December 2025 – January 2026" (year boundary)
  const monthYearLabel = createMemo(() => {
    const currentScrollTop = scrollTop();
    const currentContainerHeight = containerHeight() || window.innerHeight;

    // Get first and last visible week
    const startPixel = currentScrollTop;
    const endPixel = currentScrollTop + currentContainerHeight;

    const startWeekIndex = Math.floor((startPixel - CENTER_OFFSET) / WEEK_ROW_HEIGHT);
    const endWeekIndex = Math.ceil((endPixel - CENTER_OFFSET) / WEEK_ROW_HEIGHT);

    // Get the date at the start of the first visible week
    const startDate = getWeekStartDate(startWeekIndex);
    // Get the date at the end of the last visible week (Saturday)
    const endDate = addDays(getWeekStartDate(endWeekIndex), 6);

    const startMonth = startDate.toLocaleDateString("en-US", { month: "long" });
    const endMonth = endDate.toLocaleDateString("en-US", { month: "long" });
    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();

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

  // Handle scroll events
  const handleScroll = () => {
    if (!scrollContainerRef) return;

    // Don't update shared state until initialized - prevents corrupting visibleStartDate
    // before onMount has set the correct scroll position
    if (!isInitialized()) {
      console.log('[MonthView] handleScroll skipped - not initialized yet');
      return;
    }

    const currentScrollTop = scrollContainerRef.scrollTop;
    setScrollTop(currentScrollTop);

    // Calculate the week at the top of the visible area
    const weekIndex = getWeekIndexFromScroll(currentScrollTop);
    const currentDate = getWeekStartDate(weekIndex);

    // Update displayed month - use the month that has most days visible
    // For simplicity, use the month of the first day of the visible week
    const month = currentDate.toLocaleDateString("en-US", { month: "long" });
    const year = currentDate.getFullYear();
    setDisplayedMonth(`${month} ${year}`);

    // Update visible start date for mini-calendar sync
    if (!isSameDay(currentDate, visibleStartDate())) {
      setVisibleStartDate(currentDate);
    }
  };

  // Scroll to a specific date
  const scrollToDate = (date: Date) => {
    if (!scrollContainerRef) return;

    setSnapEnabled(false);

    const weekIndex = getWeekIndex(date);
    const targetScrollTop = CENTER_OFFSET + (weekIndex * WEEK_ROW_HEIGHT);
    console.log('[MonthView] scrollToDate:', date.toISOString(), 'weekIndex:', weekIndex, 'targetScrollTop:', targetScrollTop);

    scrollContainerRef.scrollTop = targetScrollTop;

    requestAnimationFrame(() => {
      setSnapEnabled(true);
    });
  };

  // Initialize on mount
  onMount(() => {
    if (scrollContainerRef) {
      setContainerHeight(scrollContainerRef.clientHeight);

      requestAnimationFrame(() => {
        // Scroll to current visible start date (synced from week view or navigation)
        console.log('[MonthView] onMount visibleStartDate:', visibleStartDate().toISOString());
        scrollToDate(visibleStartDate());
        // Update scrollTop signal to match actual DOM position
        setScrollTop(scrollContainerRef!.scrollTop);
        setIsInitialized(true);
        // Now handleScroll can safely update shared state
        handleScroll();
      });

      // Resize observer
      const resizeObserver = new ResizeObserver((entries) => {
        if (entries[0]?.contentRect.height > 0) {
          setContainerHeight(entries[0].contentRect.height);
          if (isInitialized()) {
            scrollToDate(visibleStartDate());
          }
        }
      });
      resizeObserver.observe(scrollContainerRef);
      onCleanup(() => resizeObserver.disconnect());
    }

    // Clear month visible weeks when unmounting to prevent stale data
    onCleanup(() => setMonthVisibleWeekIds([]));
  });

  // React to external centerDate changes (from navigation or mini-calendar)
  createEffect(() => {
    const target = centerDate();
    if (isInitialized() && scrollContainerRef) {
      scrollToDate(target);
    }
  });

  return (
    <div class="flex-1 flex flex-col min-h-0">
      {/* Month/year label row */}
      <div
        class="flex items-end pb-1 pl-3 bg-white shrink-0"
        style={{ height: "36px" }}
      >
        <span class="text-[#37352f] text-lg font-semibold whitespace-nowrap">
          {monthYearLabel()}
        </span>
      </div>

      {/* Weekday headers row */}
      <div
        class="grid grid-cols-7 border-b border-[#e8e8e8] bg-white shrink-0"
        style={{ height: `${WEEKDAY_HEADER_HEIGHT}px` }}
      >
        <For each={WEEKDAY_HEADERS}>
          {(day) => (
            <div class="px-2 py-2 text-xs font-medium text-[#91918e] text-center border-r border-[#e8e8e8] last:border-r-0">
              {day}
            </div>
          )}
        </For>
      </div>

      {/* Scrollable week rows */}
      <div
        ref={scrollContainerRef}
        class="flex-1 overflow-auto overscroll-none scrollbar-hidden"
        style={{
          position: "relative",
          "scroll-snap-type": snapEnabled() ? "y mandatory" : "none",
        }}
        onScroll={handleScroll}
      >
        {/* Virtual container */}
        <div style={{ height: `${CONTAINER_HEIGHT}px`, position: "relative" }}>
          {/* Render visible weeks */}
          <Key each={visibleWeeks()} by={(w) => getWeekKey(w.weekIndex)}>
            {(week) => (
              <div
                class="absolute left-0 right-0 grid grid-cols-7"
                style={{
                  top: `${week().top}px`,
                  height: `${WEEK_ROW_HEIGHT}px`,
                }}
              >
                {/* Month label overlay - positioned in the first column */}
                <Show when={week().monthLabel}>
                  <div
                    class="absolute left-2 top-1 text-sm font-medium text-[#37352f] z-10 pointer-events-none"
                  >
                    {week().monthLabel}
                  </div>
                </Show>

                {/* Day cells */}
                <For each={week().days}>
                  {(dayInfo) => (
                    <MonthDayCell
                      dayInfo={dayInfo}
                      isFlashing={flashDate() !== null && isSameDay(dayInfo.date, flashDate()!)}
                    />
                  )}
                </For>
              </div>
            )}
          </Key>

          {/* Phantom snap track - invisible anchors for scroll snapping */}
          <Key each={snapTrackIndices()} by={(i) => i}>
            {(weekIndex) => {
              const weekStartDate = getWeekStartDate(weekIndex());
              const isMonthStart = isFirstWeekOfMonth(weekStartDate);
              return (
                <div
                  class="pointer-events-none"
                  style={{
                    position: "absolute",
                    left: "0",
                    top: `${CENTER_OFFSET + (weekIndex() * WEEK_ROW_HEIGHT)}px`,
                    width: "100%",
                    height: `${WEEK_ROW_HEIGHT}px`,
                    "z-index": "-1",
                    "scroll-snap-align": "start",
                    "scroll-snap-stop": isMonthStart ? "always" : "normal",
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
