import { Show } from "solid-js";
import {
  ChevronLeft,
  ChevronRight,
  PanelRight,
  PanelRightClose,
  LoaderCircle,
} from "lucide-solid";
import { rightSidebarOpen, toggleRightSidebar } from "./AppShell";
import {
  visibleStartDate,
  setCenterDate,
  setFlashDate,
  setNavigationTarget,
} from "../calendar/CalendarGrid";
import {
  currentView,
  setCurrentView,
  visibleDaysCount,
  setVisibleDaysCount,
  type ViewType,
} from "../../stores/view";
import { isLoadingWeeks } from "../../stores/events";
import { isAnySyncing } from "../../stores/accounts";
import { getSundayOfWeek } from "../../lib/date-utils";

// Helper to add days to a date
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// Check if a date is within a range (inclusive)
function isDateInRange(date: Date, start: Date, end: Date): boolean {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const s = new Date(start);
  s.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(0, 0, 0, 0);
  return d >= s && d <= e;
}

export function CalendarHeader() {
  const navigatePrev = () => {
    const date = visibleStartDate();
    if (currentView() === "Month") {
      const prevMonth = new Date(date);
      prevMonth.setMonth(prevMonth.getMonth() - 1);
      setCenterDate(prevMonth);
    } else {
      // Day and Week views both use visibleDaysCount
      setCenterDate(addDays(date, -visibleDaysCount()));
    }
  };

  const navigateNext = () => {
    const date = visibleStartDate();
    if (currentView() === "Month") {
      const nextMonth = new Date(date);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      setCenterDate(nextMonth);
    } else {
      // Day and Week views both use visibleDaysCount
      setCenterDate(addDays(date, visibleDaysCount()));
    }
  };

  const goToToday = () => {
    const today = new Date();
    // In week view (7+ days), navigate to the week containing today (Sunday start)
    // In day view or smaller, navigate directly to today
    const targetDate = visibleDaysCount() >= 7 ? getSundayOfWeek(today) : today;
    setCenterDate(targetDate);
    setFlashDate(today);
    // Clear after effects have captured the flash, prevents re-triggering on scroll
    setTimeout(() => setFlashDate(null), 50);
  };

  return (
    <header class="relative flex items-center justify-between px-3 h-full">
      {/* Left section - Loading indicator */}
      <div class="flex items-center gap-2 min-w-[200px]">
        <Show when={isLoadingWeeks() || isAnySyncing()}>
          <LoaderCircle
            size={14}
            class="text-[#91918e] animate-spin"
            aria-label="Loading events"
          />
        </Show>
      </div>

      {/* Center section - Navigation with Today (absolutely centered) */}
      <div class="absolute left-1/2 -translate-x-1/2 flex items-center">
        <button
          onClick={navigatePrev}
          class="p-1 rounded hover:bg-[#efefef] text-[#91918e] hover:text-[#37352f] transition-colors"
          title="Previous"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={goToToday}
          class="px-2.5 py-1 rounded hover:bg-[#efefef] text-[#37352f] text-sm font-medium transition-colors"
        >
          Today
        </button>
        <button
          onClick={navigateNext}
          class="p-1 rounded hover:bg-[#efefef] text-[#91918e] hover:text-[#37352f] transition-colors"
          title="Next"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Right section - View switch and sidebar toggle */}
      <div class="flex items-center gap-3 min-w-[200px] justify-end">
        {/* View switch */}
        <div class="flex items-center rounded-md border border-[#e8e8e8] overflow-hidden">
          {(["Day", "Week", "Month"] as ViewType[]).map((view) => (
            <button
              onClick={() => {
                setCurrentView(view);
                // Set day count presets for Day/Week views
                if (view === "Day") {
                  // Check if today is visible BEFORE changing day count
                  const start = visibleStartDate();
                  const end = addDays(start, visibleDaysCount() - 1);
                  const today = new Date();
                  const shouldShowToday = isDateInRange(today, start, end);

                  // Set navigation target SYNCHRONOUSLY before changing visibleDaysCount.
                  // This ensures the visibleDaysCount effect uses the correct target.
                  // If today is visible, show today; otherwise show Sunday of the visible week.
                  const targetDate = shouldShowToday
                    ? today
                    : getSundayOfWeek(start);

                  // Only coordinate with visibleDaysCount effect when count changes.
                  // Setting navigationTarget without a count change leaves it stuck,
                  // blocking all future centerDate-driven scrolls (including Today).
                  if (visibleDaysCount() !== 1) {
                    setNavigationTarget(targetDate);
                  }
                  setCenterDate(targetDate);

                  setVisibleDaysCount(1);
                } else if (view === "Week") {
                  // Anchor to the week containing the current visible day
                  const start = visibleStartDate();
                  const targetDate = getSundayOfWeek(start);
                  if (visibleDaysCount() !== 7) {
                    setNavigationTarget(targetDate);
                  }
                  setCenterDate(targetDate);
                  setVisibleDaysCount(7);
                }
                // Month view uses separate component, doesn't change day count
              }}
              class="px-2.5 py-1 text-xs font-medium transition-colors"
              classList={{
                // Day: highlighted when not Month view AND exactly 1 day
                // Week: highlighted when not Month view AND exactly 7 days
                // Month: highlighted when in Month view
                "bg-[#efefef] text-[#37352f]":
                  view === "Month"
                    ? currentView() === "Month"
                    : currentView() !== "Month" &&
                      visibleDaysCount() === (view === "Day" ? 1 : 7),
                "text-[#91918e] hover:text-[#37352f] hover:bg-[#f5f5f5]": !(
                  view === "Month"
                    ? currentView() === "Month"
                    : currentView() !== "Month" &&
                      visibleDaysCount() === (view === "Day" ? 1 : 7)
                ),
              }}
            >
              {view}
            </button>
          ))}
        </div>

        {/* Right sidebar toggle */}
        <button
          onClick={toggleRightSidebar}
          class="p-1.5 rounded hover:bg-[#efefef] text-[#91918e] hover:text-[#37352f] transition-colors"
          title={rightSidebarOpen() ? "Hide right sidebar" : "Show right sidebar"}
        >
          {rightSidebarOpen() ? (
            <PanelRightClose size={18} />
          ) : (
            <PanelRight size={18} />
          )}
        </button>
      </div>
    </header>
  );
}
