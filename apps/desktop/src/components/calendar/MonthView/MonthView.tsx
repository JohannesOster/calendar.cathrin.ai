import { createSignal, createMemo, createEffect, onMount, onCleanup, For } from "solid-js";
import { Key } from "@solid-primitives/keyed";
import { type DayInfo } from "./MonthDayCell";
import { MonthWeekRow } from "./MonthWeekRow";
import { visibleStartDate, setVisibleStartDate, centerDate, flashDate, setMonthVisibleWeekIds } from "../../../stores/calendar-navigation";
import { addDays, getWeekId, isSameDay } from "../../../lib/date-utils";
import { WEEKDAY_NAMES } from "../../../constants/sidebar";
import {
  WEEK_ROW_HEIGHT,
  WEEKDAY_HEADER_HEIGHT,
  VISIBLE_BUFFER_WEEKS,
  CONTAINER_HEIGHT,
  CENTER_OFFSET,
  SNAP_TRACK_WEEKS,
  getWeekIndex,
  getWeekStartDate,
  isFirstWeekOfMonth,
  getMonthLabel,
  getWeekKey,
} from "./month-view-utils";

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
        class="flex items-end pb-1 pl-3 bg-surface shrink-0"
        style={{ height: "36px" }}
      >
        <span class="text-fg text-lg font-semibold whitespace-nowrap">
          {monthYearLabel()}
        </span>
      </div>

      {/* Weekday headers row */}
      <div
        class="grid grid-cols-7 border-b border-border bg-surface shrink-0"
        style={{ height: `${WEEKDAY_HEADER_HEIGHT}px` }}
      >
        <For each={WEEKDAY_NAMES}>
          {(day) => (
            <div class="px-2 py-2 text-xs font-medium text-fg-muted text-center border-r border-border last:border-r-0">
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
              <MonthWeekRow
                weekIndex={week().weekIndex}
                top={week().top}
                height={WEEK_ROW_HEIGHT}
                days={week().days}
                monthLabel={week().monthLabel}
                flashDate={flashDate()}
              />
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
