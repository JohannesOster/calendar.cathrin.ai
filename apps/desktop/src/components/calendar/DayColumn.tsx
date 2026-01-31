import { createSignal, createEffect, onCleanup, For } from "solid-js";
import { flashDate } from "./CalendarGrid";
import { CalendarEvent } from "./CalendarEvent";
import { events } from "../../stores/events";
import { connectedAccounts } from "../../stores/accounts";
import { calculateEventLayouts } from "../../utils/eventLayout";
import { TOTAL_GRID_HEIGHT_PX } from "../../constants/calendar";

interface DayColumnProps {
  date: Date;
}

export function DayColumn(props: DayColumnProps) {
  // Use a counter to force re-mount of flash element, restarting CSS animation
  const [flashKey, setFlashKey] = createSignal(0);
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

    // Ignore null - only react to explicit flash requests
    // This prevents canceling ongoing animations when flashDate is cleared
    if (!flash) return;

    const shouldFlash = isSameDay(flash, props.date);

    // Clear any existing timeout when flashDate changes
    if (flashTimeout) {
      clearTimeout(flashTimeout);
      flashTimeout = undefined;
    }

    if (shouldFlash) {
      // Increment key to force re-mount and restart CSS animation
      setFlashKey((k) => k + 1);
      setShowFlash(true);
      flashTimeout = window.setTimeout(() => {
        setShowFlash(false);
      }, 2000);
    } else {
      // A different date was flashed, cancel our flash
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

  // Get visible calendar IDs
  const visibleCalendarIds = () => {
    return new Set(
      connectedAccounts()
        .flatMap((a) => a.calendars)
        .filter((c) => c.visible)
        .map((c) => c.id)
    );
  };

  // Filter events for this day: must be on this day, from a visible calendar, and not all-day
  const dayEvents = () => {
    const visible = visibleCalendarIds();
    return events().filter(
      (event) =>
        isSameDay(event.start, props.date) &&
        visible.has(event.calendarId) &&
        !event.isAllDay
    );
  };

  // Calculate layout info for overlapping events
  const eventLayouts = () => calculateEventLayouts(dayEvents());

  return (
    <div
      class="relative [contain:strict]"
      style={{ height: `${TOTAL_GRID_HEIGHT_PX}px` }}
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
        {(event) => (
          <CalendarEvent event={event} layout={eventLayouts().get(event.id)} />
        )}
      </For>

      {/* Flash highlight overlay - For with key forces re-mount to restart CSS animation */}
      <For each={showFlash() ? [flashKey()] : []}>
        {() => (
          <div class="absolute inset-0 bg-[#2383e2] pointer-events-none animate-flash-highlight" />
        )}
      </For>
    </div>
  );
}
