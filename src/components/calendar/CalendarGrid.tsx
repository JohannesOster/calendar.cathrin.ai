import { createSignal, For, onMount, onCleanup, createEffect, createMemo } from "solid-js";
import { TimeColumn } from "./TimeColumn";
import { DateHeader } from "./DateHeader";
import { DayColumn } from "./DayColumn";
import { CurrentTimeBadge, CurrentTimeLine } from "./CurrentTimeIndicator";
import { addDays, getSundayOfWeek, isSameDay, formatMonthYear } from "../../lib/date-utils";

// Sliding window: small buffer since we're not virtualizing
const BUFFER_DAYS = 7; // Days on each side
const VISIBLE_DAYS = 7;
const TOTAL_DAYS = BUFFER_DAYS * 2 + VISIBLE_DAYS; // 21 days total
const TOTAL_HEIGHT = 24 * 48; // 24 hours × 48px

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
  let containerRef: HTMLDivElement | undefined;
  let scrollContainerRef: HTMLDivElement | undefined;
  let headerScrollRef: HTMLDivElement | undefined;
  let timeColumnInnerRef: HTMLDivElement | undefined;
  let isShifting = false;

  // Track which day is at left edge (for preserving view on resize)
  let leftmostDayIndex = BUFFER_DAYS;

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

  // Get current column width (for scroll calculations only)
  const getColumnWidth = () => {
    if (!scrollContainerRef) return 100;
    // Use scrollContainerRef.clientWidth to account for scrollbar gutter
    return scrollContainerRef.clientWidth / VISIBLE_DAYS;
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

    const colWidth = getColumnWidth();
    const currentScrollLeft = scrollContainerRef.scrollLeft;
    const adjustment = days * colWidth;

    // Update center date (shifts the window)
    setCenterDate(addDays(centerDate(), days));

    // Adjust scroll position to maintain visual continuity
    requestAnimationFrame(() => {
      if (scrollContainerRef) {
        const newScrollLeft = currentScrollLeft - adjustment;
        scrollContainerRef.scrollLeft = newScrollLeft;
        if (headerScrollRef) {
          headerScrollRef.scrollLeft = newScrollLeft;
        }
      }
      setTimeout(() => { isShifting = false; }, 50);
    });
  };

  // Handle scroll - sync header and time column
  const handleScroll = () => {
    if (!scrollContainerRef) return;

    const scrollLeft = scrollContainerRef.scrollLeft;
    const scrollTop = scrollContainerRef.scrollTop;

    // Sync header scroll (horizontal)
    if (headerScrollRef) {
      headerScrollRef.scrollLeft = scrollLeft;
    }

    // Sync time column position (using transform for pixel-perfect alignment)
    if (timeColumnInnerRef) {
      timeColumnInnerRef.style.transform = `translateY(-${scrollTop}px)`;
    }

    // Track which day is at left edge
    const colWidth = getColumnWidth();
    if (colWidth > 0) {
      leftmostDayIndex = Math.round(scrollLeft / colWidth);
      // Update the visible start date signal for mini-calendar sync
      const days = visibleDays();
      if (days[leftmostDayIndex]) {
        setVisibleStartDate(days[leftmostDayIndex]);
      }
    }

    // Update month display and check buffer
    updateDisplayedMonth();
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
    if (headerScrollRef) {
      headerScrollRef.scrollLeft = newScrollLeft;
    }
  };

  // Snap to nearest day after scroll ends
  let scrollEndTimeout: number | undefined;
  const handleScrollWithSnap = () => {
    handleScroll();

    if (scrollEndTimeout) {
      clearTimeout(scrollEndTimeout);
    }

    scrollEndTimeout = window.setTimeout(() => {
      if (!scrollContainerRef || isShifting) return;

      const colWidth = getColumnWidth();
      const scrollLeft = scrollContainerRef.scrollLeft;
      const nearestDay = Math.round(scrollLeft / colWidth);
      const targetScroll = nearestDay * colWidth;

      if (Math.abs(scrollLeft - targetScroll) > 1) {
        scrollContainerRef.scrollTo({ left: targetScroll, behavior: "smooth" });
        if (headerScrollRef) {
          headerScrollRef.scrollTo({ left: targetScroll, behavior: "smooth" });
        }
      }
    }, 150);
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

    // Set up ResizeObserver to preserve visible days on resize
    if (scrollContainerRef) {
      const resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(scrollContainerRef);
      onCleanup(() => resizeObserver.disconnect());
    }

    // Scroll to show Sunday of current week as leftmost day
    requestAnimationFrame(() => {
      if (scrollContainerRef) {
        const colWidth = getColumnWidth();
        const days = visibleDays();
        const sunday = getSundayOfWeek(new Date());
        const sundayIndex = days.findIndex((d) => isSameDay(d, sunday));

        if (sundayIndex !== -1) {
          leftmostDayIndex = sundayIndex;
          scrollContainerRef.scrollLeft = sundayIndex * colWidth;
          if (headerScrollRef) {
            headerScrollRef.scrollLeft = sundayIndex * colWidth;
          }
          // Initialize visible start date
          setVisibleStartDate(days[sundayIndex]);
        }

        // Scroll vertically to current time
        const now = new Date();
        const hours = now.getHours();
        const scrollPosition = Math.max(0, (hours - 2) * 48);
        scrollContainerRef.scrollTop = scrollPosition;
        if (timeColumnInnerRef) {
          timeColumnInnerRef.style.transform = `translateY(-${scrollPosition}px)`;
        }

        updateDisplayedMonth();
      }
    });
  });

  onCleanup(() => {
    if (scrollEndTimeout) clearTimeout(scrollEndTimeout);
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
          scrollContainerRef.scrollLeft = centerIndex * colWidth;
          if (headerScrollRef) {
            headerScrollRef.scrollLeft = centerIndex * colWidth;
          }
          // Update visible start date for mini-calendar sync
          setVisibleStartDate(days[centerIndex]);
          updateDisplayedMonth();
        }
      }
    });
  });

  return (
    <div
      ref={containerRef}
      class="flex-1 flex flex-col max-h-full overflow-hidden"
    >
      {/* Month/Year indicator */}
      <div class="px-4 py-2 bg-white border-b border-[#e8e8e8] shrink-0">
        <span class="text-lg font-medium text-[#37352f]">{displayedMonth()}</span>
      </div>

      {/* Header row with date headers */}
      <div class="flex border-b border-[#e8e8e8] bg-white shrink-0 h-10">
        {/* Time column spacer */}
        <div class="w-[var(--grid-time-col-width)] shrink-0 border-r border-[#e8e8e8]">
        </div>

        {/* Scrollable date headers */}
        <div ref={headerScrollRef} class="flex-1 overflow-hidden">
          <div class="flex h-full" style={{ width: `${(TOTAL_DAYS / VISIBLE_DAYS) * 100}%` }}>
            <For each={visibleDays()}>
              {(day) => (
                <div class="flex-1 min-w-0 h-full border-r border-[#e8e8e8]">
                  <DateHeader date={day} />
                </div>
              )}
            </For>
          </div>
        </div>
      </div>

      {/* Grid body */}
      <div class="flex-1 flex min-h-0 overflow-hidden">
        {/* Time column - fixed, syncs via transform (not scrollable) */}
        <div class="w-[var(--grid-time-col-width)] shrink-0 border-r border-[#e8e8e8] bg-white overflow-y-hidden">
          <div ref={timeColumnInnerRef} class="relative" style={{ height: `${TOTAL_HEIGHT}px` }}>
            <TimeColumn />
            <CurrentTimeBadge />
          </div>
        </div>

        {/* Scrollable day columns - scrollbar hidden for clean edge alignment */}
        <div
          ref={scrollContainerRef}
          class="flex-1 overflow-auto overscroll-y-none scrollbar-hidden"
          onScroll={handleScrollWithSnap}
        >
          <div
            class="flex relative"
            style={{
              width: `${(TOTAL_DAYS / VISIBLE_DAYS) * 100}%`,
              height: `${TOTAL_HEIGHT}px`
            }}
          >
            <For each={visibleDays()}>
              {(day) => (
                <div class="flex-1 min-w-0 border-r border-[#e8e8e8]" style={{ height: `${TOTAL_HEIGHT}px` }}>
                  <DayColumn date={day} />
                </div>
              )}
            </For>
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
