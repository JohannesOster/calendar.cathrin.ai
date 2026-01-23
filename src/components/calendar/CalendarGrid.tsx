import { createSignal, For, createEffect, onMount } from "solid-js";
import { TimeColumn } from "./TimeColumn";
import { DateHeader } from "./DateHeader";
import { DayColumn } from "./DayColumn";

export function CalendarGrid() {
  const [currentDate, setCurrentDate] = createSignal(new Date());
  let scrollContainerRef: HTMLDivElement | undefined;

  // Get week days centered around current date
  const getWeekDays = () => {
    const date = currentDate();
    const days: Date[] = [];

    // Start from Sunday of the current week
    const startOfWeek = new Date(date);
    const dayOfWeek = startOfWeek.getDay();
    startOfWeek.setDate(startOfWeek.getDate() - dayOfWeek);

    for (let i = 0; i < 7; i++) {
      const day = new Date(startOfWeek);
      day.setDate(startOfWeek.getDate() + i);
      days.push(day);
    }

    return days;
  };

  // Scroll to current time on mount
  onMount(() => {
    if (scrollContainerRef) {
      const now = new Date();
      const hours = now.getHours();
      const hourHeight = 48; // matches --grid-hour-height
      // Scroll to show current time in the upper portion of view
      const scrollPosition = Math.max(0, (hours - 2) * hourHeight);
      scrollContainerRef.scrollTop = scrollPosition;
    }
  });

  return (
    <div class="flex-1 flex flex-col overflow-hidden">
      {/* All-day events row (placeholder) */}
      <div class="flex border-b border-[#e8e8e8] bg-white shrink-0">
        {/* Time column spacer with "All-day" label */}
        <div class="w-[var(--grid-time-col-width)] shrink-0 flex items-center justify-end pr-2 py-2">
          <span class="text-xs text-[#91918e]">All-day</span>
        </div>

        {/* Day headers */}
        <div class="flex-1 flex min-w-0">
          <For each={getWeekDays()}>
            {(day) => <DateHeader date={day} />}
          </For>
        </div>
      </div>

      {/* Scrollable grid body */}
      <div
        ref={scrollContainerRef}
        class="flex-1 overflow-auto min-w-0"
      >
        <div class="flex min-h-full min-w-0">
          {/* Sticky time column */}
          <div class="w-[var(--grid-time-col-width)] shrink-0 sticky left-0 bg-white z-10 border-r border-[#e8e8e8]">
            <TimeColumn />
          </div>

          {/* Day columns */}
          <div class="flex-1 flex min-w-0">
            <For each={getWeekDays()}>
              {(day) => <DayColumn date={day} />}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
}
