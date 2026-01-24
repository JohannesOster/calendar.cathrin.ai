import { createSignal, createEffect, onCleanup, Show } from "solid-js";
import { flashDate } from "./CalendarGrid";

interface DateHeaderProps {
  date: Date;
  isToday?: boolean;
}

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function DateHeader(props: DateHeaderProps) {
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

  const dayName = () => dayNames[props.date.getDay()];
  const dayNumber = () => props.date.getDate();

  return (
    <div class="relative h-full flex items-center justify-center">
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
