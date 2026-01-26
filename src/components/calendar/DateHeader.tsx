import { createSignal, createEffect, onCleanup, Show } from "solid-js";
import { flashDate } from "./CalendarGrid";
import { isSameDay } from "../../lib/date-utils";

interface DateHeaderProps {
  date: Date;
  isToday?: boolean;
}

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function DateHeader(props: DateHeaderProps) {
  const [showFlash, setShowFlash] = createSignal(false);

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

  const dayName = () => dayNames[props.date.getDay()];
  const dayNumber = () => props.date.getDate();

  return (
    <div class="relative h-full flex items-center justify-center border-b border-[#e8e8e8]">
      <span class="text-sm text-[#91918e]">
        {dayName()} {dayNumber()}
      </span>

      {/* Flash highlight overlay */}
      <Show when={showFlash()}>
        <div class="absolute inset-0 bg-[#2383e2] pointer-events-none animate-flash-highlight" />
      </Show>
    </div>
  );
}
