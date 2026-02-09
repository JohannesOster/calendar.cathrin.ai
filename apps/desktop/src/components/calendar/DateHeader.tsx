import { createSignal, createEffect, onCleanup, For } from "solid-js";
import { flashDate } from "../../stores/calendar-navigation";
import { isSameDay } from "../../lib/date-utils";
import { FLASH_DURATION_MS } from "../../constants/timings";
import { WEEKDAY_NAMES } from "../../constants/sidebar";

interface DateHeaderProps {
  date: Date;
  isToday?: boolean;
}

export function DateHeader(props: DateHeaderProps) {
  // Use a counter to force re-mount of flash element, restarting CSS animation
  const [flashKey, setFlashKey] = createSignal(0);
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
      // Increment key to force re-mount and restart CSS animation
      setFlashKey((k) => k + 1);
      setShowFlash(true);
      flashTimeout = window.setTimeout(() => {
        setShowFlash(false);
      }, FLASH_DURATION_MS);
    } else {
      // A different date was flashed, cancel our flash
      setShowFlash(false);
    }
  });
  onCleanup(() => {
    if (flashTimeout) clearTimeout(flashTimeout);
  });

  const dayName = () => WEEKDAY_NAMES[props.date.getDay()];
  const dayNumber = () => props.date.getDate();

  return (
    <div class="relative h-full flex items-center justify-center border-b border-border">
      <span class="text-xs text-fg-muted">{dayName()}</span>
      <span
        class="text-xs ml-0.5 w-5 h-5 flex items-center justify-center rounded"
        classList={{
          "bg-accent text-white": props.isToday,
          "text-fg-muted": !props.isToday,
        }}
      >
        {dayNumber()}
      </span>

      {/* Flash highlight overlay - For with key forces re-mount to restart CSS animation */}
      <For each={showFlash() ? [flashKey()] : []}>
        {() => (
          <div class="absolute inset-0 bg-accent pointer-events-none animate-flash-highlight" />
        )}
      </For>
    </div>
  );
}
