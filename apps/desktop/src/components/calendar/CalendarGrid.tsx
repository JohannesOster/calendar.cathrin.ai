import {
  createSignal,
  onMount,
  onCleanup,
  createEffect,
  createMemo,
  on,
  Show,
  For,
} from "solid-js";
import { Key } from "@solid-primitives/keyed";
import { LoaderCircle, ChevronsUpDown, ChevronsDownUp } from "lucide-solid";
import { TimeColumn } from "./TimeColumn";
import { DateHeader } from "./DateHeader";
import { DayColumn } from "./DayColumn";
import { CurrentTimeBadge, CurrentTimeLine } from "./CurrentTimeIndicator";
import { MonthView } from "./MonthView";
import {
  calculateAllDaySectionHeight,
  type AllDayEventLayout,
} from "./AllDaySection";
import { AllDayEventChip } from "./AllDayEventChip";
import {
  addDays,
  isSameDay,
  isToday,
  formatMonthYear,
  getWeekId,
} from "../../lib/date-utils";
import { events, isLoadingWeeks } from "../../stores/events";
import { connectedAccounts, isAnySyncing } from "../../stores/accounts";
import { calculateAllDayLayouts } from "../../utils/allDayLayout";
import { currentView } from "../../stores/view";

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

// ============================================================================
// Constants - Virtual Scroll Container
// ============================================================================
const CONTAINER_WIDTH = 500000; // Large virtual width for infinite scroll
const CENTER_OFFSET = CONTAINER_WIDTH / 2; // Anchor point in middle

// ============================================================================
// Constants - Scroll Snap
// ============================================================================
const SNAP_TRACK_RANGE = 730; // Days in each direction from anchor for snap points (2 years)

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
export const [displayedMonth, setDisplayedMonth] = createSignal("");
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

// Active visible weeks - switches between week view and month view based on currentView
// This is the signal that the events store should react to
export const activeVisibleWeeks = createMemo(() => {
  if (currentView() === "Month") {
    return monthVisibleWeekIds();
  }
  return visibleWeeks();
});

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

  // All-day section expand/collapse state
  const [allDayExpanded, setAllDayExpanded] = createSignal(false);
  const toggleAllDayExpanded = () => setAllDayExpanded((prev) => !prev);

  // Track scroll direction for prefetching
  let lastScrollLeft = CENTER_OFFSET;
  let directionResetTimer: ReturnType<typeof setTimeout> | undefined;

  // Get the time column width from CSS variable
  const getTimeColWidth = () => {
    const cssValue = getComputedStyle(
      document.documentElement,
    ).getPropertyValue("--grid-time-col-width");
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
    CENTER_OFFSET + dayIndex * width;

  // Calculate visible day range based on scroll position
  const visibleDays = createMemo(() => {
    const width = colWidth();
    const currentScrollLeft = scrollLeft();
    const currentContainerWidth = containerWidth() || window.innerWidth;
    const anchor = anchorDate();

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
        left: getDayLeftPosition(i, width),
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

  // Get visible calendar IDs for filtering events
  const visibleCalendarIds = createMemo(() => {
    return new Set(
      connectedAccounts()
        .flatMap((a) => a.calendars)
        .filter((c) => c.visible)
        .map((c) => c.id)
    );
  });

  // Calculate all-day event layouts for the visible week
  const allDayEventLayouts = createMemo((): AllDayEventLayout[] => {
    const days = visibleDays();
    if (days.length === 0) return [];

    // Find first and last visible day (excluding buffer days)
    // Buffer days extend beyond visible area, so find the actual visible 7-day range
    const width = colWidth();
    const currentScrollLeft = scrollLeft();
    const timeColWidth = getTimeColWidth();

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
    const layouts = calculateAllDayLayouts(visibleEvents, viewStart, viewEnd, totalColumns);

    // Convert to pixel positions
    const result: AllDayEventLayout[] = [];
    const firstDayLeft = days[0].left;

    for (const [eventId, layoutInfo] of layouts) {
      const event = visibleEvents.find((e) => e.id === eventId);
      if (!event) continue;

      // Calculate pixel position from column info
      const left = firstDayLeft + layoutInfo.startCol * width;
      const chipWidth = layoutInfo.span * width - 4; // 4px gap

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
    const days = visibleDays();
    const width = colWidth();

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

  // Check if toggle should show based on VISIBLE (not buffer) events only
  const shouldShowToggle = createMemo(() => {
    if (allDayExpanded()) return true;

    const layouts = allDayEventLayouts();
    if (layouts.length === 0) return false;

    const timeColWidth = getTimeColWidth();
    const currentScrollLeft = scrollLeft();

    // Calculate the actual visible pixel range (after time column)
    const visibleStartPx = currentScrollLeft + timeColWidth;
    const visibleEndPx = currentScrollLeft + (containerWidth() || window.innerWidth);

    // Filter to only visible layouts
    const visibleLayouts = layouts.filter((layout) => {
      const eventStartPx = layout.left;
      const eventEndPx = layout.left + layout.width;
      return eventStartPx < visibleEndPx && eventEndPx > visibleStartPx;
    });

    // Show toggle if any visible event is in row 1+
    if (visibleLayouts.some(l => l.row >= 1)) return true;

    // Also check if any visible day has multiple events
    const counts = eventCountsPerDay();
    const days = visibleDays();
    const width = colWidth();

    for (const day of days) {
      const dayStartPx = day.left;
      const dayEndPx = day.left + width;

      // Day is visible if it overlaps with the visible range
      const isVisible = dayStartPx < visibleEndPx && dayEndPx > visibleStartPx;
      if (!isVisible) continue;

      const count = counts.get(getDateKey(day.date)) ?? 0;
      if (count > 1) return true;
    }

    return false;
  });

  // Calculate all-day section height based on max row of VISIBLE events only
  // This prevents the section from expanding due to off-screen events in the buffer
  const allDayHeight = createMemo(() => {
    const layouts = allDayEventLayouts();
    if (layouts.length === 0) return calculateAllDaySectionHeight(-1, allDayExpanded());

    const days = visibleDays();
    if (days.length === 0) return calculateAllDaySectionHeight(-1, allDayExpanded());

    const width = colWidth();
    const timeColWidth = getTimeColWidth();
    const currentScrollLeft = scrollLeft();

    // Calculate the actual visible pixel range (after time column)
    const visibleStartPx = currentScrollLeft + timeColWidth;
    const visibleEndPx = currentScrollLeft + (containerWidth() || window.innerWidth);

    // Filter to events that overlap with the visible pixel range
    const visibleLayouts = layouts.filter((layout) => {
      const eventStartPx = layout.left;
      const eventEndPx = layout.left + layout.width;

      // Event is visible if it overlaps with the visible range
      return eventStartPx < visibleEndPx && eventEndPx > visibleStartPx;
    });

    const maxRow =
      visibleLayouts.length === 0 ? -1 : Math.max(...visibleLayouts.map((l) => l.row));
    return calculateAllDaySectionHeight(maxRow, allDayExpanded());
  });

  // Total content height = header + all-day section + time grid
  const contentHeight = createMemo(() =>
    HEADER_HEIGHT + allDayHeight() + TOTAL_HEIGHT
  );

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
        setScrollDirection("right"); // Scrolling toward future
      } else if (currentScrollLeft < lastScrollLeft - DIRECTION_THRESHOLD_PX) {
        setScrollDirection("left"); // Scrolling toward past
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
      const currentDate = addDays(anchorDate(), dayIndex);

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
      const newWeeks =
        startWeek === endWeek ? [startWeek] : [startWeek, endWeek];

      // Only update if weeks actually changed
      const currentWeeks = visibleWeeks();
      if (
        newWeeks.length !== currentWeeks.length ||
        newWeeks.some((w, i) => w !== currentWeeks[i])
      ) {
        setVisibleWeeks(newWeeks);
      }
    }
  };

  // Virtual Scroll to a specific date
  const scrollToDate = (date: Date) => {
    if (!scrollContainerRef) return;

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
    const currentColWidth = colWidth();
    const targetScrollLeft =
      CENTER_OFFSET + diffDays * currentColWidth - timeColWidth;

    // Disable snap, wait for DOM update, then scroll
    setSnapEnabled(false);

    // Use double-RAF to ensure CSS change is applied before scroll
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (scrollContainerRef) {
          scrollContainerRef.scrollLeft = targetScrollLeft;

          // Explicitly update state after programmatic scroll
          // (browser scroll events may not fire reliably for programmatic changes)
          handleScroll();

          // Re-enable snap after scroll completes (give it time to settle)
          setTimeout(() => {
            setSnapEnabled(true);
          }, 50);
        }
      });
    });
  };

  // Initialize on mount
  onMount(() => {
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
        const eventWrapper = activeEl?.closest(
          "[data-event-id]",
        ) as HTMLElement | null;
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

  // React to external centerDate changes (e.g. from Mini Calendar or header navigation)
  // Using on() with defer to only react when centerDate actually changes,
  // not on initial mount (handled by onMount)
  // Note: Month view manages its own scroll via MonthView component
  createEffect(
    on(
      centerDate,
      (target) => {
        if (currentView() !== "Month") {
          scrollToDate(target);
        }
      },
      { defer: true },
    ),
  );

  // When switching from Month view back to Week view, restore scroll position
  // and update visibleWeeks signal (since onMount doesn't run again)
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
          // Give the DOM time to render the week view container
          requestAnimationFrame(() => {
            scrollToDate(visibleStartDate());
            handleScroll();
          });
        }
      },
      { defer: true },
    ),
  );

  return (
    <div class="flex-1 flex flex-col max-h-full overflow-hidden">
      {/* Month/Year indicator - outside scroll container */}
      <div class="px-4 py-2 bg-white border-b border-[#e8e8e8] shrink-0 flex items-center gap-2">
        <span class="text-lg font-medium text-[#37352f]">
          {displayedMonth()}
        </span>
        <Show when={isLoadingWeeks() || isAnySyncing()}>
          <LoaderCircle
            size={16}
            class="text-[#91918e] animate-spin"
            aria-label="Loading events"
          />
        </Show>
      </div>

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

              {/* Sticky All-Day Section Row - matches header row structure */}
              <div
                class="flex bg-white border-b border-[#e8e8e8] transition-[height] duration-200 ease-out"
                style={{
                  position: "sticky",
                  top: `${HEADER_HEIGHT}px`,
                  "z-index": "10", // Same as header row
                  height: `${allDayHeight()}px`,
                  width: "100%",
                }}
              >
                {/* Sticky corner - matches time column header corner */}
                <div
                  class="bg-white border-r border-b border-[#e8e8e8] flex items-start justify-end pt-1 pr-2"
                  style={{
                    width: "var(--grid-time-col-width)",
                    height: `${allDayHeight()}px`,
                    "flex-shrink": "0",
                    position: "sticky",
                    left: "0",
                    "z-index": "20", // Higher than event chips
                  }}
                >
                  {/* Show toggle button if multiple events, or "All day" label if single events */}
                  <Show
                    when={shouldShowToggle()}
                    fallback={
                      <Show when={allDayEventLayouts().length > 0}>
                        <span class="text-[10px] text-[#91918e] font-light">All day</span>
                      </Show>
                    }
                  >
                    <button
                      class="text-[#91918e] hover:text-[#37352f] hover:bg-[#efefef] rounded p-0.5 transition-colors"
                      onClick={toggleAllDayExpanded}
                      tabIndex={0}
                      aria-label={allDayExpanded() ? "Collapse all-day events" : "Expand all-day events"}
                    >
                      {allDayExpanded() ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
                    </button>
                  </Show>
                </div>

                {/* Absolute day slots - matches header date slots */}
                <Key each={visibleDays()} by={(d) => getDateKey(d.date)}>
                  {(item) => (
                    <div
                      class="absolute border-r border-b border-[#e8e8e8] bg-white"
                      style={{
                        left: `${item().left}px`,
                        width: `${colWidth()}px`,
                        height: `${allDayHeight()}px`,
                        top: 0,
                      }}
                    />
                  )}
                </Key>

                {/* All-day event chips (when expanded, or for columns with single events when collapsed) */}
                <Show
                  when={allDayExpanded()}
                  fallback={
                    <>
                      {/* When collapsed: show chips only for columns with single events */}
                      {/* Use Key with event.id to preserve DOM focus during scroll */}
                      <Key each={allDayEventLayouts().filter(l => l.row < 1)} by={(l) => l.event.id}>
                        {(layout) => {
                          // Check if this chip spans any column with multiple events
                          // Use accessors inside to stay reactive
                          const shouldHide = () => {
                            const width = colWidth();
                            const days = visibleDays();
                            const counts = eventCountsPerDay();
                            const chipStartPx = layout().left;
                            const chipEndPx = layout().left + layout().width;

                            return days.some(day => {
                              const dayStartPx = day.left;
                              const dayEndPx = day.left + width;
                              const overlaps = chipStartPx < dayEndPx && chipEndPx > dayStartPx;
                              const count = counts.get(getDateKey(day.date)) ?? 0;
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
                          const count = () => eventCountsPerDay().get(getDateKey(day().date)) ?? 0;

                          return (
                            <Show when={count() > 1}>
                              <div
                                class="absolute flex items-center px-1.5 text-xs text-[#91918e] font-light cursor-pointer hover:text-[#37352f] transition-colors"
                                style={{
                                  left: `${day().left}px`,
                                  width: `${colWidth()}px`,
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
              </div>

              {/* Sticky Time Column Body - Sticky Left, below all-day section */}
              <div
                class="bg-white border-r border-[#e8e8e8]"
                style={{
                  width: "var(--grid-time-col-width)",
                  height: `${TOTAL_HEIGHT}px`,
                  position: "sticky",
                  left: "0",
                  "z-index": "5", // Below all-day section (z-index 10) so it scrolls beneath
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
                    class="absolute border-r border-[#e8e8e8] transition-[top] duration-200 ease-out"
                    style={{
                      left: `${item().left}px`,
                      width: `${colWidth()}px`,
                      height: `${TOTAL_HEIGHT}px`,
                      top: `${HEADER_HEIGHT + allDayHeight()}px`, // Below header and all-day section
                      "z-index": "1",
                    }}
                  >
                    <DayColumn date={item().date} />
                  </div>
                )}
              </Key>

              {/* Current Time Line - spans full width at current time position */}
              <div
                class="transition-[top] duration-200 ease-out"
                style={{
                  position: "absolute",
                  left: "0",
                  top: `${HEADER_HEIGHT + allDayHeight()}px`,
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
                        left: `${getDayLeftPosition(dayIndex(), colWidth())}px`,
                        width: `${colWidth()}px`,
                        height: `${contentHeight()}px`,
                        "z-index": "-1",
                        "scroll-snap-align": "start",
                        "scroll-snap-stop": isWeekStart(date)
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
