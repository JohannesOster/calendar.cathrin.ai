import { createSignal, createEffect, For } from "solid-js";
import { centerDate, setCenterDate } from "../calendar/CalendarGrid";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Link,
  Eye,
  EyeOff,
  MoreHorizontal,
  Plus,
} from "lucide-solid";

interface CalendarAccount {
  email: string;
  calendars: Calendar[];
}

interface Calendar {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  isDefault?: boolean;
}

// Sample data
const sampleAccounts: CalendarAccount[] = [
  {
    email: "user@example.com",
    calendars: [
      {
        id: "1",
        name: "Personal",
        color: "#ff7b72",
        visible: true,
        isDefault: true,
      },
      { id: "2", name: "Work", color: "#79c0ff", visible: true },
      { id: "3", name: "Family", color: "#a5d6ff", visible: true },
    ],
  },
];

export function LeftSidebar() {
  const [searchQuery, setSearchQuery] = createSignal("");
  const [currentMonth, setCurrentMonth] = createSignal(new Date());
  const [accounts, setAccounts] = createSignal(sampleAccounts);

  interface DayInfo {
    day: number;
    date: Date;
    isCurrentMonth: boolean;
  }

  // Get weeks for the month view, including days from adjacent months
  const getWeeksInMonth = (date: Date): DayInfo[][] => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay(); // 0 = Sunday

    const weeks: DayInfo[][] = [];
    let currentWeek: DayInfo[] = [];

    // Add days from previous month to fill the first week
    if (startingDay > 0) {
      const prevMonthLastDay = new Date(year, month, 0).getDate();
      for (let i = startingDay - 1; i >= 0; i--) {
        const day = prevMonthLastDay - i;
        currentWeek.push({
          day,
          date: new Date(year, month - 1, day),
          isCurrentMonth: false,
        });
      }
    }

    // Add days of the current month
    for (let i = 1; i <= daysInMonth; i++) {
      currentWeek.push({
        day: i,
        date: new Date(year, month, i),
        isCurrentMonth: true,
      });

      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }

    // Add days from next month to fill the last week
    let nextMonthDay = 1;
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) {
        currentWeek.push({
          day: nextMonthDay,
          date: new Date(year, month + 1, nextMonthDay),
          isCurrentMonth: false,
        });
        nextMonthDay++;
      }
      weeks.push(currentWeek);
    }

    // Always show 6 rows for consistent height
    while (weeks.length < 6) {
      const extraWeek: DayInfo[] = [];
      for (let i = 0; i < 7; i++) {
        extraWeek.push({
          day: nextMonthDay,
          date: new Date(year, month + 1, nextMonthDay),
          isCurrentMonth: false,
        });
        nextMonthDay++;
      }
      weeks.push(extraWeek);
    }

    return weeks;
  };

  const formatMonthYear = (date: Date) => {
    return date.toLocaleString("default", { month: "long", year: "numeric" });
  };

  const prevMonth = () => {
    const date = new Date(currentMonth());
    date.setMonth(date.getMonth() - 1);
    setCurrentMonth(date);
  };

  const nextMonth = () => {
    const date = new Date(currentMonth());
    date.setMonth(date.getMonth() + 1);
    setCurrentMonth(date);
  };

  const isTodayDate = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const toggleCalendarVisibility = (accountEmail: string, calendarId: string) => {
    setAccounts((prev) =>
      prev.map((account) => {
        if (account.email === accountEmail) {
          return {
            ...account,
            calendars: account.calendars.map((cal) => {
              if (cal.id === calendarId) {
                return { ...cal, visible: !cal.visible };
              }
              return cal;
            }),
          };
        }
        return account;
      })
    );
  };

  // Get Sunday of any week
  const getSundayOfWeek = (date: Date): Date => {
    const result = new Date(date);
    result.setDate(date.getDate() - date.getDay());
    return result;
  };

  // Check if a week row is the active week (visible in main grid)
  const isActiveWeek = (week: DayInfo[]): boolean => {
    const weekStart = getSundayOfWeek(centerDate());
    weekStart.setHours(0, 0, 0, 0);
    // Check if the first day of this week matches the active week's Sunday
    const rowSunday = new Date(week[0].date);
    rowSunday.setHours(0, 0, 0, 0);
    return rowSunday.getTime() === weekStart.getTime();
  };

  // Handle day click - navigate main grid to that week
  const handleDayClick = (dayInfo: DayInfo) => {
    const weekStart = getSundayOfWeek(dayInfo.date);
    setCenterDate(weekStart);
  };

  // Track previous centerDate to detect external navigation changes
  let prevCenterDate = centerDate();

  // Sync mini calendar month only when centerDate changes (not on manual month browsing)
  createEffect(() => {
    const center = centerDate();
    // Only sync if centerDate actually changed (external navigation)
    if (
      center.getTime() !== prevCenterDate.getTime()
    ) {
      prevCenterDate = center;
      // Update mini calendar month to show the new active week
      if (
        center.getMonth() !== currentMonth().getMonth() ||
        center.getFullYear() !== currentMonth().getFullYear()
      ) {
        setCurrentMonth(new Date(center.getFullYear(), center.getMonth(), 1));
      }
    }
  });

  return (
    <div class="h-full flex flex-col overflow-hidden">
      {/* Search section */}
      <div class="p-3 border-b border-[#e8e8e8]">
        <div class="relative">
          <Search
            size={16}
            class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#91918e]"
          />
          <input
            type="text"
            placeholder="Search events"
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            class="w-full pl-8 pr-3 py-1.5 text-sm bg-[#f1f1ef] rounded-md border-none outline-none placeholder:text-[#91918e] text-[#37352f] focus:ring-2 focus:ring-[#2383e2] focus:ring-opacity-50"
          />
        </div>
      </div>

      {/* Mini Calendar */}
      <div class="p-3 border-b border-[#e8e8e8]">
        {/* Month navigation */}
        <div class="flex items-center justify-between mb-3">
          <span class="text-sm font-medium text-[#37352f]">
            {formatMonthYear(currentMonth())}
          </span>
          <div class="flex items-center gap-1">
            <button
              onClick={prevMonth}
              class="p-1 rounded hover:bg-[#efefef] text-[#91918e] hover:text-[#37352f]"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={nextMonth}
              class="p-1 rounded hover:bg-[#efefef] text-[#91918e] hover:text-[#37352f]"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {/* Weekday headers */}
        <div class="grid grid-cols-7 mb-1">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
            <div class="text-center text-xs text-[#91918e] py-1">{day}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div class="flex flex-col">
          <For each={getWeeksInMonth(currentMonth())}>
            {(week) => (
              <div
                class="grid grid-cols-7 rounded-sm transition-colors"
                classList={{
                  "bg-[#f1f1ef]": isActiveWeek(week),
                }}
              >
                <For each={week}>
                  {(dayInfo) => (
                    <button
                      class="aspect-square flex items-center justify-center text-xs rounded-full transition-colors"
                      classList={{
                        "text-[#37352f]": dayInfo.isCurrentMonth && !isTodayDate(dayInfo.date),
                        "text-[#c4c4c4]": !dayInfo.isCurrentMonth,
                        "bg-[#2383e2] text-white hover:bg-[#2383e2]": isTodayDate(dayInfo.date),
                        "hover:bg-[#e3e3e3]": !isTodayDate(dayInfo.date),
                      }}
                      onClick={() => handleDayClick(dayInfo)}
                    >
                      {dayInfo.day}
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>

      {/* Scheduling Link */}
      <div class="p-3 border-b border-[#e8e8e8]">
        <button class="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-[#37352f] hover:bg-[#efefef] rounded transition-colors">
          <Link size={16} class="text-[#91918e]" />
          <span>Scheduling</span>
        </button>
      </div>

      {/* Calendar Accounts List */}
      <div class="flex-1 overflow-auto p-3">
        <For each={accounts()}>
          {(account) => (
            <div class="mb-4">
              {/* Account header */}
              <div class="flex items-center justify-between mb-2 group">
                <span class="text-xs font-medium text-[#91918e] truncate">
                  {account.email}
                </span>
                <button class="p-1 rounded hover:bg-[#efefef] text-[#91918e] opacity-0 group-hover:opacity-100 transition-opacity">
                  <MoreHorizontal size={14} />
                </button>
              </div>

              {/* Calendars */}
              <div class="space-y-0.5">
                <For each={account.calendars}>
                  {(calendar) => (
                    <div class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#efefef] group cursor-pointer">
                      {/* Color indicator */}
                      <div
                        class="w-4 h-4 rounded flex-shrink-0"
                        style={{ "background-color": calendar.color }}
                      />

                      {/* Calendar name */}
                      <span
                        class="flex-1 text-sm truncate"
                        classList={{
                          "text-[#37352f]": calendar.visible,
                          "text-[#91918e] line-through": !calendar.visible,
                        }}
                      >
                        {calendar.name}
                      </span>

                      {/* Default badge */}
                      {calendar.isDefault && (
                        <span class="text-xs text-[#91918e]">Default</span>
                      )}

                      {/* Visibility toggle */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCalendarVisibility(account.email, calendar.id);
                        }}
                        class="p-1 rounded hover:bg-[#d8d8d8] text-[#91918e] opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        {calendar.visible ? (
                          <Eye size={14} />
                        ) : (
                          <EyeOff size={14} />
                        )}
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>

      {/* Add calendar button */}
      <div class="p-3 border-t border-[#e8e8e8]">
        <button class="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-[#91918e] hover:text-[#37352f] hover:bg-[#efefef] rounded transition-colors">
          <Plus size={16} />
          <span>Add calendar account</span>
        </button>
      </div>
    </div>
  );
}
