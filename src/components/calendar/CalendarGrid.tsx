import { createSignal, For, onMount, onCleanup, createEffect } from "solid-js";
import { TimeColumn } from "./TimeColumn";
import { DateHeader } from "./DateHeader";
import { DayColumn } from "./DayColumn";

// Buffer size: days to render on each side of the viewport
const BUFFER_DAYS = 14;
const VISIBLE_DAYS = 7;
const TOTAL_DAYS = BUFFER_DAYS * 2 + VISIBLE_DAYS; // 35 days total
const TIME_COLUMN_WIDTH = 64; // matches --grid-time-col-width
const TOTAL_HEIGHT = 24 * 48; // 24 hours × 48px

// Export signals for external control (e.g., from CalendarHeader)
export const [centerDate, setCenterDate] = createSignal(new Date());
export const [displayedMonth, setDisplayedMonth] = createSignal("");

// Helper to format month/year display
function formatMonthYear(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// Helper to add days to a date
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// Helper to check if two dates are the same day
function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getDate() === date2.getDate() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getFullYear() === date2.getFullYear()
  );
}

export function CalendarGrid() {
  let containerRef: HTMLDivElement | undefined;
  let scrollContainerRef: HTMLDivElement | undefined;
  let headerScrollRef: HTMLDivElement | undefined;
  let timeColumnRef: HTMLDivElement | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let isScrolling = false;
  let isResizing = false;
  let rafId: number | undefined;
  let lastScrollLeft = 0;

  // Track the leftmost visible day index to preserve across resizes
  let leftmostDayIndex = BUFFER_DAYS; // Start centered
  let lastContainerWidth = 0; // Track container width to avoid redundant resize handling

  // Dynamic column width based on container size (use exact decimal for no gaps)
  const [columnWidth, setColumnWidth] = createSignal(120);

  // Calculate column width to fit exactly VISIBLE_DAYS in the container
  const calculateColumnWidth = () => {
    if (!containerRef) return;
    const availableWidth = containerRef.clientWidth - TIME_COLUMN_WIDTH;
    // Use exact decimal width to fill container perfectly (no gap)
    const newWidth = availableWidth / VISIBLE_DAYS;
    if (newWidth > 0 && Math.abs(newWidth - columnWidth()) > 0.01) {
      setColumnWidth(newWidth);
    }
  };

  // Get the leftmost visible day index from current scroll position
  const getLeftmostDayIndex = () => {
    if (!scrollContainerRef) return leftmostDayIndex;
    const colWidth = columnWidth();
    if (colWidth <= 0) return leftmostDayIndex;
    return Math.round(scrollContainerRef.scrollLeft / colWidth);
  };

  // Generate array of dates centered around centerDate
  const getVisibleDays = () => {
    const center = centerDate();
    const days: Date[] = [];

    // Start from BUFFER_DAYS before center
    const startDate = addDays(center, -BUFFER_DAYS - Math.floor(VISIBLE_DAYS / 2));

    for (let i = 0; i < TOTAL_DAYS; i++) {
      days.push(addDays(startDate, i));
    }

    return days;
  };

  // Update displayed month based on leftmost visible date
  const updateDisplayedMonth = (dayIndex: number) => {
    const days = getVisibleDays();

    if (days[dayIndex]) {
      const newMonth = formatMonthYear(days[dayIndex]);
      if (newMonth !== displayedMonth()) {
        setDisplayedMonth(newMonth);
      }
    }
  };

  // Check if we need to shift the date buffer
  const checkAndShiftBuffer = (dayIndex: number) => {
    if (!scrollContainerRef || isScrolling || isResizing) return;

    const threshold = 3; // Shift when within 3 columns of edge

    if (dayIndex < threshold) {
      // Near left edge - shift buffer left (add earlier dates)
      shiftBuffer(-7);
    } else if (dayIndex > TOTAL_DAYS - VISIBLE_DAYS - threshold) {
      // Near right edge - shift buffer right (add later dates)
      shiftBuffer(7);
    }
  };

  // Optimized scroll handler using requestAnimationFrame
  const handleScroll = () => {
    if (!scrollContainerRef || isResizing) return;

    const scrollLeft = scrollContainerRef.scrollLeft;
    const scrollTop = scrollContainerRef.scrollTop;

    // Sync header scroll horizontally
    if (headerScrollRef) {
      headerScrollRef.scrollLeft = scrollLeft;
    }

    // Sync time column scroll vertically
    if (timeColumnRef) {
      timeColumnRef.scrollTop = scrollTop;
    }

    // Only process horizontal scroll changes for day index updates
    if (Math.abs(scrollLeft - lastScrollLeft) < 1) return;
    lastScrollLeft = scrollLeft;

    // Update leftmost day index
    leftmostDayIndex = getLeftmostDayIndex();

    // Cancel any pending RAF
    if (rafId) {
      cancelAnimationFrame(rafId);
    }

    // Batch updates in next animation frame
    rafId = requestAnimationFrame(() => {
      updateDisplayedMonth(leftmostDayIndex);
      checkAndShiftBuffer(leftmostDayIndex);
    });
  };

  // Snap to nearest day column after scroll ends
  const handleScrollEnd = () => {
    if (!scrollContainerRef || isScrolling || isResizing) return;

    const colWidth = columnWidth();
    const scrollLeft = scrollContainerRef.scrollLeft;
    const nearestDay = Math.round(scrollLeft / colWidth);
    const targetScroll = nearestDay * colWidth;

    if (Math.abs(scrollLeft - targetScroll) > 1) {
      scrollContainerRef.scrollTo({
        left: targetScroll,
        behavior: "smooth"
      });
      if (headerScrollRef) {
        headerScrollRef.scrollTo({
          left: targetScroll,
          behavior: "smooth"
        });
      }
    }
  };

  // Debounced scroll end detection
  let scrollEndTimeout: number | undefined;
  const handleScrollWithSnap = () => {
    handleScroll();

    // Clear existing timeout
    if (scrollEndTimeout) {
      clearTimeout(scrollEndTimeout);
    }

    // Set new timeout for scroll end detection
    scrollEndTimeout = window.setTimeout(() => {
      handleScrollEnd();
    }, 150);
  };

  // Shift the buffer by moving centerDate
  const shiftBuffer = (days: number) => {
    if (!scrollContainerRef) return;

    isScrolling = true;

    const colWidth = columnWidth();
    const currentScrollLeft = scrollContainerRef.scrollLeft;
    const adjustment = days * colWidth;

    // Update center date
    setCenterDate(addDays(centerDate(), days));

    // After DOM updates, adjust scroll position to maintain visual continuity
    requestAnimationFrame(() => {
      if (scrollContainerRef) {
        const newScrollLeft = currentScrollLeft - adjustment;
        scrollContainerRef.scrollLeft = newScrollLeft;
        if (headerScrollRef) {
          headerScrollRef.scrollLeft = newScrollLeft;
        }
        lastScrollLeft = newScrollLeft;
        leftmostDayIndex = getLeftmostDayIndex();
      }
      // Small delay before allowing next shift
      setTimeout(() => {
        isScrolling = false;
      }, 50);
    });
  };

  // Handle resize - preserve visible days
  let resizeDebounceTimeout: number | undefined;

  const handleResize = () => {
    if (!scrollContainerRef || !containerRef) return;

    // Skip if container width hasn't actually changed (threshold of 2px to avoid micro-changes)
    const currentWidth = containerRef.clientWidth;
    if (Math.abs(currentWidth - lastContainerWidth) < 2) return;
    lastContainerWidth = currentWidth;

    isResizing = true;

    // Store the current leftmost day index BEFORE recalculating width
    const preservedDayIndex = leftmostDayIndex;

    // Calculate new width directly (don't update signal yet)
    const availableWidth = currentWidth - TIME_COLUMN_WIDTH;
    const newWidth = availableWidth / VISIBLE_DAYS;

    if (newWidth <= 0) {
      isResizing = false;
      return;
    }

    // Calculate new scroll position BEFORE updating column width
    const newScrollLeft = preservedDayIndex * newWidth;

    // Set scroll position first (while old widths are still rendered)
    scrollContainerRef.scrollLeft = newScrollLeft;
    if (headerScrollRef) {
      headerScrollRef.scrollLeft = newScrollLeft;
    }
    lastScrollLeft = newScrollLeft;

    // Now update column width signal (triggers re-render)
    if (Math.abs(newWidth - columnWidth()) > 0.01) {
      setColumnWidth(newWidth);
    }

    // Debounce the cleanup - wait for resize to settle
    if (resizeDebounceTimeout) {
      clearTimeout(resizeDebounceTimeout);
    }

    resizeDebounceTimeout = window.setTimeout(() => {
      isResizing = false;
    }, 50);
  };

  // Scroll to current time on mount
  onMount(() => {
    // Initialize container width tracking
    if (containerRef) {
      lastContainerWidth = containerRef.clientWidth;
    }

    // Calculate initial column width
    calculateColumnWidth();

    // Set up ResizeObserver to recalculate on container resize
    if (containerRef) {
      resizeObserver = new ResizeObserver((entries) => {
        // Skip if already handling a resize
        if (isResizing) return;

        // Check if width actually changed (threshold to avoid animation micro-changes)
        const entry = entries[0];
        if (entry && Math.abs(entry.contentRect.width - lastContainerWidth) < 2) return;

        // Defer to next frame to avoid "ResizeObserver loop" warning
        requestAnimationFrame(() => {
          handleResize();
        });
      });
      resizeObserver.observe(containerRef);
    }

    // Initialize displayed month
    setDisplayedMonth(formatMonthYear(centerDate()));

    // Wait for column width to be calculated
    requestAnimationFrame(() => {
      if (scrollContainerRef) {
        const colWidth = columnWidth();

        // First, scroll horizontally to center on today
        const days = getVisibleDays();
        const todayIndex = days.findIndex((d) => isSameDay(d, new Date()));

        if (todayIndex !== -1) {
          const horizontalScroll = todayIndex * colWidth;
          scrollContainerRef.scrollLeft = horizontalScroll;
          lastScrollLeft = horizontalScroll;
          leftmostDayIndex = todayIndex;
          if (headerScrollRef) {
            headerScrollRef.scrollLeft = horizontalScroll;
          }
        }

        // Then scroll vertically to current time
        const now = new Date();
        const hours = now.getHours();
        const hourHeight = 48; // matches --grid-hour-height
        const scrollPosition = Math.max(0, (hours - 2) * hourHeight);
        scrollContainerRef.scrollTop = scrollPosition;

        // Sync time column vertical scroll
        if (timeColumnRef) {
          timeColumnRef.scrollTop = scrollPosition;
        }

        // Update displayed month after initial scroll
        updateDisplayedMonth(leftmostDayIndex);
      }
    });
  });

  onCleanup(() => {
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
    if (scrollEndTimeout) {
      clearTimeout(scrollEndTimeout);
    }
    if (resizeDebounceTimeout) {
      clearTimeout(resizeDebounceTimeout);
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
  });

  // React to external centerDate changes (e.g., from "Today" button)
  createEffect(() => {
    const center = centerDate();
    const colWidth = columnWidth();

    // Only scroll if this is an external change (not from buffer shift)
    if (!isScrolling && !isResizing && scrollContainerRef && colWidth > 0) {
      const days = getVisibleDays();
      const centerIndex = days.findIndex((d) => isSameDay(d, center));

      // If center date is not well-positioned in buffer, trigger re-render and scroll
      if (centerIndex < 0 || centerIndex >= TOTAL_DAYS) {
        // Date is outside buffer, will be re-rendered
        requestAnimationFrame(() => {
          if (scrollContainerRef) {
            const newDays = getVisibleDays();
            const newIndex = newDays.findIndex((d) => isSameDay(d, center));
            if (newIndex !== -1) {
              const scrollPos = newIndex * colWidth;
              scrollContainerRef.scrollLeft = scrollPos;
              if (headerScrollRef) {
                headerScrollRef.scrollLeft = scrollPos;
              }
              lastScrollLeft = scrollPos;
              leftmostDayIndex = newIndex;
              updateDisplayedMonth(newIndex);
            }
          }
        });
      }
    }
  });

  // Computed values for rendering
  const totalWidth = () => TOTAL_DAYS * columnWidth();

  return (
    <div ref={containerRef} class="flex-1 flex flex-col min-h-0 min-w-0 max-h-full max-w-full overflow-hidden">
      {/* Month/Year indicator */}
      <div class="px-4 py-2 bg-white border-b border-[#e8e8e8] shrink-0">
        <span class="text-lg font-medium text-[#37352f]">{displayedMonth()}</span>
      </div>

      {/* All-day events row with date headers */}
      <div class="flex border-b border-[#e8e8e8] bg-white shrink-0 min-w-0">
        {/* Time column spacer with "All-day" label */}
        <div class="w-[var(--grid-time-col-width)] shrink-0 flex items-center justify-end pr-2 py-2 border-r border-[#e8e8e8] bg-white z-20">
          <span class="text-xs text-[#91918e]">All-day</span>
        </div>

        {/* Day headers - horizontally scrollable, synced with main grid */}
        <div
          ref={headerScrollRef}
          class="flex-1 min-w-0 overflow-hidden"
        >
          <div class="flex" style={{ width: `${totalWidth()}px` }}>
            <For each={getVisibleDays()}>
              {(day) => (
                <div
                  class="shrink-0 border-r border-[#e8e8e8]"
                  style={{ width: `${columnWidth()}px` }}
                >
                  <DateHeader date={day} />
                </div>
              )}
            </For>
          </div>
        </div>
      </div>

      {/* Grid body - time column fixed, day columns scroll */}
      <div class="flex-1 flex min-h-0 min-w-0">
        {/* Time column - fixed horizontally, syncs vertical scroll with day columns */}
        <div
          ref={timeColumnRef}
          class="w-[var(--grid-time-col-width)] shrink-0 border-r border-[#e8e8e8] bg-white overflow-y-auto overflow-x-hidden scrollbar-hidden [overscroll-behavior:none]"
        >
          <div style={{ height: `${TOTAL_HEIGHT}px` }}>
            <TimeColumn />
          </div>
        </div>

        {/* Scrollable day columns - both horizontal and vertical */}
        <div
          ref={scrollContainerRef}
          class="flex-1 min-h-0 min-w-0 overflow-scroll [-webkit-overflow-scrolling:touch] [overscroll-behavior:none]"
          onScroll={handleScrollWithSnap}
        >
          <div
            class="flex"
            style={{
              width: `${totalWidth()}px`,
              height: `${TOTAL_HEIGHT}px`,
              "min-height": `${TOTAL_HEIGHT}px`
            }}
          >
            <For each={getVisibleDays()}>
              {(day) => (
                <div
                  class="shrink-0 border-r border-[#e8e8e8] [contain:layout_style]"
                  style={{ width: `${columnWidth()}px`, height: `${TOTAL_HEIGHT}px` }}
                >
                  <DayColumn date={day} />
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
}

// Export scroll function for external use
export function scrollToToday() {
  setCenterDate(new Date());
}
