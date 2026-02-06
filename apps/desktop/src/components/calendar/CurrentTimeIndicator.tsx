import { createSignal, onMount, onCleanup } from "solid-js";

interface CurrentTimeIndicatorProps {
  totalDays: number;
  visibleDaysCount: number;
}

const HOUR_HEIGHT = 48; // matches --grid-hour-height

function formatCurrentTime(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  const displayMinutes = minutes.toString().padStart(2, "0");
  return `${displayHours}:${displayMinutes}${period}`;
}

function getTimePosition(date: Date): number {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const totalMinutes = hours * 60 + minutes;
  return (totalMinutes / 60) * HOUR_HEIGHT;
}

/**
 * Time badge component that sits in the time column area
 */
export function CurrentTimeBadge() {
  const [now, setNow] = createSignal(new Date());

  onMount(() => {
    // Update every minute
    const interval = setInterval(() => {
      setNow(new Date());
    }, 60000);
    onCleanup(() => clearInterval(interval));
  });

  return (
    <div
      class="absolute left-0 right-0 z-20 pointer-events-none"
      style={{
        top: `${getTimePosition(now())}px`,
      }}
    >
      {/* Time badge */}
      <div class="absolute right-0 -translate-y-1/2 bg-[#ea4335] text-white text-[10px] font-medium px-1.5 py-0.5 rounded-sm leading-none whitespace-nowrap">
        {formatCurrentTime(now())}
      </div>
    </div>
  );
}

/**
 * Horizontal line component that spans across all day columns
 */
export function CurrentTimeLine(props: CurrentTimeIndicatorProps) {
  const [now, setNow] = createSignal(new Date());

  onMount(() => {
    // Update every minute
    const interval = setInterval(() => {
      setNow(new Date());
    }, 60000);
    onCleanup(() => clearInterval(interval));
  });

  return (
    <div
      class="absolute left-0 z-20 pointer-events-none"
      style={{
        top: `${getTimePosition(now())}px`,
        width: `${(props.totalDays / props.visibleDaysCount) * 100}%`,
      }}
    >
      {/* Thin line spanning all columns */}
      <div class="absolute left-0 right-0 h-px bg-[#ea4335]" />
    </div>
  );
}
