import { createSignal } from "solid-js";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  PanelRight,
  PanelRightClose,
} from "lucide-solid";
import { rightSidebarOpen, setRightSidebarOpen } from "./AppShell";
import { centerDate, setCenterDate } from "../calendar/CalendarGrid";

type ViewType = "Day" | "Week" | "Month";

// Helper to add days to a date
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function CalendarHeader() {
  const [currentView, setCurrentView] = createSignal<ViewType>("Week");
  const [viewDropdownOpen, setViewDropdownOpen] = createSignal(false);

  const navigatePrev = () => {
    const date = centerDate();
    switch (currentView()) {
      case "Day":
        setCenterDate(addDays(date, -1));
        break;
      case "Week":
        setCenterDate(addDays(date, -7));
        break;
      case "Month":
        const prevMonth = new Date(date);
        prevMonth.setMonth(prevMonth.getMonth() - 1);
        setCenterDate(prevMonth);
        break;
    }
  };

  const navigateNext = () => {
    const date = centerDate();
    switch (currentView()) {
      case "Day":
        setCenterDate(addDays(date, 1));
        break;
      case "Week":
        setCenterDate(addDays(date, 7));
        break;
      case "Month":
        const nextMonth = new Date(date);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        setCenterDate(nextMonth);
        break;
    }
  };

  const goToToday = () => {
    setCenterDate(new Date());
  };

  return (
    <header class="flex items-center px-3 h-full">
      {/* Left section - Navigation controls */}


      {/* Center section - View selector (centered) */}
      <div class="flex-1 flex justify-center">
        {/* View Selector */}
      <div class="relative">
          <button
            onClick={() => setViewDropdownOpen((v) => !v)}
            class="flex items-center gap-1 px-2 py-1 rounded hover:bg-[#efefef] text-[#37352f] text-sm font-medium transition-colors"
          >
            <span>{currentView()}</span>
            <ChevronDown size={14} class="text-[#91918e]" />
          </button>

          {viewDropdownOpen() && (
            <>
              <div
                class="fixed inset-0 z-10"
                onClick={() => setViewDropdownOpen(false)}
              />
              <div class="absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-white rounded-lg shadow-lg border border-[#e8e8e8] py-1 z-20 min-w-[100px]">
                {(["Day", "Week", "Month"] as ViewType[]).map((view) => (
                  <button
                    onClick={() => {
                      setCurrentView(view);
                      setViewDropdownOpen(false);
                    }}
                    class="w-full px-3 py-1.5 text-left text-sm hover:bg-[#efefef] text-[#37352f]"
                    classList={{
                      "bg-[#efefef]": currentView() === view,
                    }}
                  >
                    {view}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
                {/* Today button */}
                <button
          onClick={goToToday}
          class="px-2.5 py-1 rounded hover:bg-[#efefef] text-[#37352f] text-sm font-medium transition-colors"
        >
          Today
        </button>

        {/* Navigation arrows */}
        <button
          onClick={navigatePrev}
          class="ml-1 p-1 rounded hover:bg-[#efefef] text-[#91918e] hover:text-[#37352f] transition-colors"
          title="Previous"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={navigateNext}
          class="p-1 rounded hover:bg-[#efefef] text-[#91918e] hover:text-[#37352f] transition-colors"
          title="Next"
        >
          <ChevronRight size={18} />
        </button>

      </div>

      {/* Right section - Sidebar toggle */}
      <div class="flex items-center gap-2">
        {/* Right sidebar toggle */}
        <button
          onClick={() => setRightSidebarOpen((v) => !v)}
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
