import { createSignal, createEffect, onCleanup, Show, For } from "solid-js";
import { flashDate } from "./CalendarGrid";
import { CalendarEvent } from "./CalendarEvent";
import { mockEvents } from "../../data/mockEvents";

interface DayColumnProps {
  date: Date;
}

// Total height: 24 hours × 48px = 1152px
const TOTAL_HEIGHT = 24 * 48;

export function DayColumn(props: DayColumnProps) {
  const [showFlash, setShowFlash] = createSignal(false);

  const isSameDay = (date1: Date, date2: Date): boolean => {
    return (
      date1.getDate() === date2.getDate() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getFullYear() === date2.getFullYear()
    );
  };

  // Flash effect when this day is selected from mini-calendar
  let flashTimeout: number | undefined;
  createEffect(() => {
    const flash = flashDate();
    const shouldFlash = flash && isSameDay(flash, props.date);

    // Clear any existing timeout when flashDate changes
    if (flashTimeout) {
      clearTimeout(flashTimeout);
      flashTimeout = undefined;
    }

    if (shouldFlash) {
      setShowFlash(true);
      flashTimeout = window.setTimeout(() => {
        setShowFlash(false);
      }, 2000);
    } else {
      // Reset if we were previously flashing but no longer match
      setShowFlash(false);
    }
  });
  onCleanup(() => {
    if (flashTimeout) clearTimeout(flashTimeout);
  });

  const isWeekend = () => {
    const day = props.date.getDay();
    return day === 0 || day === 6;
  };

  // Filter events for this day
  const dayEvents = () => {
    return mockEvents.filter((event) => isSameDay(event.start, props.date));
  };

  return (
    <div
      class="relative [contain:strict]"
      style={{ height: `${TOTAL_HEIGHT}px` }}
      classList={{
        "bg-[#fafafa]": isWeekend(),
      }}
    >
      {/* Hour grid lines rendered via CSS background for performance */}
      {/* Start at 48px (1 hour) to avoid line at y=0, lines appear at 48, 96, 144... (1AM, 2AM, 3AM...) */}
      <div
        class="absolute left-0 right-0 bottom-0 pointer-events-none"
        style={{
          top: "var(--grid-hour-height)",
          "background-image": "linear-gradient(to bottom, #e8e8e8 1px, transparent 1px)",
          "background-size": "100% var(--grid-hour-height)",
        }}
      />

      {/* Calendar events */}
      <For each={dayEvents()}>
        {(event) => <CalendarEvent event={event} />}
      </For>

      {/* Flash highlight overlay */}
      <Show when={showFlash()}>
        <div class="absolute inset-0 bg-[#2383e2] pointer-events-none animate-flash-highlight" />
      </Show>
    </div>
  );
}
