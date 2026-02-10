import {
  createSignal,
  onMount,
  onCleanup,
  createMemo,
  Show,
} from "solid-js";
import { Key } from "@solid-primitives/keyed";
import { ChevronsUpDown, ChevronsDownUp } from "lucide-solid";
import { TimeColumn } from "./TimeColumn";
import { DateHeader } from "./DateHeader";
import { DayColumn } from "./DayColumn";
import { DaysStepperButton } from "./DaysStepperButton";
import { CurrentTimeBadge, CurrentTimeLine } from "./CurrentTimeIndicator";
import { MonthView } from "./MonthView";
import { AllDayEventChip } from "./AllDayEventChip";
import { AllDayPlaceholder } from "./AllDayPlaceholder";
import { addDays, isToday } from "../../lib/date-utils";
import {
  isCreating,
  draftIsAllDay,
} from "../../stores/event-creation";
import {
  HOUR_HEIGHT_PX,
  MONTH_LABEL_HEIGHT,
  HEADER_HEIGHT,
  ALL_DAY_BASE_HEIGHT,
  CONTAINER_WIDTH,
  CENTER_OFFSET,
} from "../../constants/calendar";
import { CHIP_BORDER_RADIUS, ALL_DAY_ROW_HEIGHT } from "../../constants/layout";
import {
  currentView,
  visibleDaysCount,
  initVisibleDaysCount,
  createVisibleDaysPersistence,
} from "../../stores/view";
import {
  getDateKey,
  isWeekStart,
  getInitialAnchor,
  anchorDate,
  setAnchorDate,
  centerDate,
  setCenterDate,
  setVisibleStartDate,
  visibleStartDate,
} from "../../stores/calendar-navigation";
import { stopAutoScroll } from "../../lib/auto-scroll";
import {
  getDayLeftPosition,
  getTimeColWidth,
  type LayoutResult,
} from "./grid-layout";
import { createGridLayout } from "./grid-layout";
import { createGridScroll } from "./grid-scroll";
import { createDragHandlers } from "./grid-drag-handlers";
import { createAllDayState, AllDayFlashOverlay, TOTAL_HEIGHT } from "./grid-allday";
import { setupKeyboardHandlers } from "./grid-keyboard";

export function CalendarGrid() {
  let scrollContainerRef: HTMLDivElement | undefined;
  const isInitialized = { current: false };

  const [isRestoringScrollPosition, setIsRestoringScrollPosition] = createSignal(false);
  const scrollGeneration = { current: 0 };

  const [scrollLeft, setScrollLeft] = createSignal(CENTER_OFFSET);
  const [containerWidth, setContainerWidth] = createSignal(0);
  const [frozenLayout, setFrozenLayout] = createSignal<LayoutResult>({
    width: 120,
    days: [],
    leftEdge: CENTER_OFFSET,
    dayAtLeftEdge: 0,
  });
  const [colWidth, setColWidth] = createSignal(120);
  const [snapEnabled, setSnapEnabled] = createSignal(true);
  const snapReEnableTimer: { current: ReturnType<typeof setTimeout> | undefined } = { current: undefined };

  // --- Grid Layout ---
  // handleScroll is needed by commitLayoutTransition, but it's defined in grid-scroll which
  // depends on grid-layout. We solve this with a late-bound reference.
  let handleScrollRef: () => void = () => {};

  const gridLayout = createGridLayout({
    getScrollContainerRef: () => scrollContainerRef,
    scrollLeft,
    containerWidth,
    setContainerWidth,
    colWidth,
    setColWidth,
    frozenLayout,
    setFrozenLayout,
    isRestoringScrollPosition,
    setIsRestoringScrollPosition,
    setScrollLeft,
    snapEnabled,
    setSnapEnabled,
    snapReEnableTimer,
    handleScroll: () => handleScrollRef(),
  });

  // --- All-Day State ---
  const allDay = createAllDayState({
    layout: gridLayout.layout,
    visibleDays: gridLayout.visibleDays,
    scrollLeft,
    containerWidth,
    isRestoringScrollPosition,
  });

  // --- Grid Scroll ---
  const gridScroll = createGridScroll({
    getScrollContainerRef: () => scrollContainerRef,
    isInitialized,
    isRestoringScrollPosition,
    setIsRestoringScrollPosition,
    scrollGeneration,
    snapEnabled,
    setSnapEnabled,
    snapReEnableTimer,
    scrollLeft,
    setScrollLeft,
    colWidth,
    getScrollLeftForDate: gridLayout.getScrollLeftForDate,
    getDayLeftPosition,
    commitLayoutTransition: gridLayout.commitLayoutTransition,
    calculateColumnWidth: gridLayout.calculateColumnWidth,
    getColumnWidth: gridLayout.getColumnWidth,
    layout: gridLayout.layout,
    setupResizeObserver: gridLayout.setupResizeObserver,
  });

  // Wire up the late-bound handleScroll reference
  handleScrollRef = gridScroll.handleScroll;

  // --- Drag Handlers ---
  const dragHandlers = createDragHandlers({
    getScrollContainerRef: () => scrollContainerRef,
    colWidth,
    snapEnabled,
    setSnapEnabled,
    visualAllDayHeight: allDay.visualAllDayHeight,
    handleScroll: gridScroll.handleScroll,
  });

  // --- Keyboard Handlers ---
  setupKeyboardHandlers();

  // --- Persist visible days count ---
  createVisibleDaysPersistence();

  // --- Month/Year Label ---
  const monthYearLabel = createMemo(() => {
    const start = visibleStartDate();
    const end = addDays(start, visibleDaysCount() - 1);

    const startMonth = start.toLocaleDateString("en-US", { month: "long" });
    const endMonth = end.toLocaleDateString("en-US", { month: "long" });
    const startYear = start.getFullYear();
    const endYear = end.getFullYear();

    if (startYear !== endYear) {
      return `${startMonth} ${startYear} – ${endMonth} ${endYear}`;
    }
    if (startMonth !== endMonth) {
      return `${startMonth} – ${endMonth} ${endYear}`;
    }
    return `${startMonth} ${startYear}`;
  });

  // --- Initialize on mount ---
  onMount(() => {
    initVisibleDaysCount();

    const freshAnchor = getInitialAnchor();
    setAnchorDate(freshAnchor);
    gridScroll.setSnapCenter(0);

    gridScroll.setSkipNextCenterDateScroll(true);
    if (visibleDaysCount() < 7) {
      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0);
      setCenterDate(todayDate);
      setVisibleStartDate(todayDate);
    } else {
      setCenterDate(new Date(freshAnchor));
      setVisibleStartDate(new Date(freshAnchor));
    }

    setSnapEnabled(false);
    gridLayout.getColumnWidth();

    requestAnimationFrame(() => {
      if (scrollContainerRef) {
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

        scrollContainerRef.scrollLeft = targetScrollLeft;

        const currentHour = new Date().getHours();
        const scrollPosition = Math.max(
          0,
          (currentHour - 2) * HOUR_HEIGHT_PX,
        );
        scrollContainerRef.scrollTop = scrollPosition;

        gridScroll.handleScroll();

        isInitialized.current = true;
        gridScroll.setSkipNextCenterDateScroll(false);

        setTimeout(() => {
          setSnapEnabled(true);
        }, 300);
      }
    });

    // Setup initial ResizeObserver
    if (scrollContainerRef) {
      gridLayout.setupResizeObserver(isInitialized);
      // Note: ResizeObserver disconnect is handled inside setupResizeObserver
    }

    // Document-level drag handlers
    document.addEventListener("pointermove", dragHandlers.handleDragPointerMove);
    document.addEventListener("pointerup", dragHandlers.handleDragPointerUp);
    onCleanup(() => {
      stopAutoScroll();
      document.body.classList.remove("dragging");
      document.removeEventListener("pointermove", dragHandlers.handleDragPointerMove);
      document.removeEventListener("pointerup", dragHandlers.handleDragPointerUp);
    });

    // Cleanup timers
    onCleanup(() => gridScroll.directionResetTimerCleanup());
    onCleanup(() => {
      if (snapReEnableTimer.current) clearTimeout(snapReEnableTimer.current);
    });
    onCleanup(() => allDay.cleanupExpandAnimation());
  });

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
              "overflow-anchor": "none",
            }}
            onScroll={gridScroll.handleScroll}
          >
            {/* Inner Virtual Container - Extremely Wide */}
            <div
              style={{
                width: `${CONTAINER_WIDTH}px`,
                height: `${allDay.contentHeight()}px`,
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
                  height: `${allDay.contentHeight()}px`,
                  "background-color": "var(--color-border)",
                  "z-index": "22",
                }}
              />
              {/* Sticky Month/Year Label Row */}
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

                {/* Days Stepper Button */}
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
                <Key each={gridLayout.visibleDays()} by={(d) => getDateKey(d.date)}>
                  {(item) => (
                    <div
                      class="absolute bg-surface"
                      style={{
                        left: "0",
                        transform: `translateX(${item().left}px)`,
                        width: `${gridLayout.layout().width}px`,
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
                  height: `${allDay.visualAllDayHeight()}px`,
                  "margin-bottom": `${-(allDay.visualAllDayHeight() - ALL_DAY_BASE_HEIGHT)}px`,
                  "box-shadow": allDay.allDayExpanded() ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
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
                    height: `${allDay.visualAllDayHeight()}px`,
                    "flex-shrink": "0",
                    position: "sticky",
                    left: "0",
                    "z-index": "20",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ visibility: isRestoringScrollPosition() ? "hidden" : "visible" }}>
                    <Show
                      when={allDay.shouldShowToggle()}
                      fallback={
                        <Show when={allDay.allDayEventLayouts().length > 0 || (isCreating() && draftIsAllDay())}>
                          <span class="text-[10px] text-fg-muted font-light">
                            All day
                          </span>
                        </Show>
                      }
                    >
                      <button
                        class="text-fg-muted hover:text-fg hover:bg-surface-hover rounded py-0.5 pl-0.5 transition-colors"
                        onClick={allDay.toggleAllDayExpanded}
                        tabIndex={0}
                        aria-label={
                          allDay.allDayExpanded()
                            ? "Collapse all-day events"
                            : "Expand all-day events"
                        }
                      >
                        {allDay.allDayExpanded() ? (
                          <ChevronsDownUp size={14} />
                        ) : (
                          <ChevronsUpDown size={14} />
                        )}
                      </button>
                    </Show>
                  </div>
                </div>

                {/* Clipping wrapper */}
                <div class="absolute inset-0 overflow-hidden" style={{ "z-index": "1" }}>
                  {/* Absolute day slots */}
                  <Key each={gridLayout.visibleDays()} by={(d) => getDateKey(d.date)}>
                    {(item) => (
                      <div
                        class="absolute border-l border-b border-border bg-surface"
                        style={{
                          left: "0",
                          transform: `translateX(${item().left}px)`,
                          width: `${gridLayout.layout().width}px`,
                          height: `${allDay.visualAllDayHeight()}px`,
                          top: 0,
                        }}
                      >
                        <AllDayFlashOverlay date={() => item().date} />
                      </div>
                    )}
                  </Key>

                  {/* All-day event chips */}
                  <Show
                    when={allDay.allDayExpanded()}
                    fallback={
                      <>
                        <Key
                          each={allDay.allDayEventLayouts().filter((l) => l.row < 1)}
                          by={(l) => l.event.id}
                        >
                          {(layout) => {
                            const shouldHide = () => {
                              const width = layout().width;
                              const days = gridLayout.visibleDays();
                              const counts = allDay.eventCountsPerDay();
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

                        {/* "X events" labels for collapsed columns */}
                        <Key each={gridLayout.visibleDays()} by={(d) => getDateKey(d.date)}>
                          {(day) => {
                            const count = () =>
                              allDay.eventCountsPerDay().get(getDateKey(day().date)) ??
                              0;

                            return (
                              <Show when={count() > 1}>
                                <div
                                  class="absolute flex items-center px-1.5 text-xs text-fg-muted font-light cursor-pointer hover:text-fg transition-colors"
                                  style={{
                                    left: "0",
                                    transform: `translateX(${day().left}px)`,
                                    width: `${gridLayout.layout().width}px`,
                                    top: "4px",
                                    height: "var(--grid-all-day-chip-height)",
                                  }}
                                  onClick={allDay.toggleAllDayExpanded}
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
                    <Key each={allDay.allDayEventLayouts()} by={(l) => l.event.id}>
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
                  <AllDayPlaceholder days={gridLayout.visibleDays()} colWidth={gridLayout.layout().width} row={allDay.allDayPlaceholderRow()} />

                  {/* Ghost chip showing original position during unfold drag */}
                  <Show when={allDay.unfoldOriginalGhost()}>
                    {(ghost) => (
                      <div
                        class="absolute rounded pointer-events-none"
                        style={{
                          left: "0",
                          transform: `translateX(${ghost().left}px)`,
                          width: `${ghost().width}px`,
                          top: `${ghost().row * ALL_DAY_ROW_HEIGHT + 4}px`,
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

              {/* Sticky Time Column Body */}
              <div
                class="bg-surface border-r border-border"
                style={{
                  width: "var(--grid-time-col-width)",
                  "min-width": "var(--grid-time-col-width)",
                  "max-width": "var(--grid-time-col-width)",
                  height: `${TOTAL_HEIGHT}px`,
                  "margin-top": `${Math.max(0, allDay.visualAllDayHeight() - ALL_DAY_BASE_HEIGHT)}px`,
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
              <Key each={gridLayout.visibleDays()} by={(d) => getDateKey(d.date)}>
                {(item) => (
                  <div
                    class="absolute border-l border-border"
                    style={{
                      left: "0",
                      transform: `translateX(${item().left}px)`,
                      width: `${gridLayout.layout().width}px`,
                      height: `${TOTAL_HEIGHT}px`,
                      top: `${MONTH_LABEL_HEIGHT + HEADER_HEIGHT + allDay.visualAllDayHeight()}px`,
                      "z-index": "1",
                    }}
                  >
                    <DayColumn date={item().date} />
                  </div>
                )}
              </Key>

              {/* Current Time Line */}
              <div
                style={{
                  position: "absolute",
                  left: "0",
                  top: `${MONTH_LABEL_HEIGHT + HEADER_HEIGHT + allDay.visualAllDayHeight()}px`,
                  width: "100%",
                  height: `${TOTAL_HEIGHT}px`,
                  "pointer-events": "none",
                  "z-index": "5",
                }}
              >
                <CurrentTimeLine totalDays={1} visibleDaysCount={1} />
              </div>

              {/* Phantom Snap Track */}
              <Key each={gridScroll.snapTrackIndices()} by={(i) => i}>
                {(dayIndex) => {
                  const date = addDays(anchorDate(), dayIndex());
                  return (
                    <div
                      class="pointer-events-none"
                      style={{
                        position: "absolute",
                        top: "0",
                        left: "0",
                        transform: `translateX(${getDayLeftPosition(dayIndex(), gridLayout.layout().width)}px)`,
                        width: `${gridLayout.layout().width}px`,
                        height: `${allDay.contentHeight()}px`,
                        "z-index": "-1",
                        "scroll-snap-align":
                          isRestoringScrollPosition()
                            ? "none"
                            : visibleDaysCount() === 7 && !isWeekStart(date)
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
