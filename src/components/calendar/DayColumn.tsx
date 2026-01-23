import { For } from "solid-js";

interface DayColumnProps {
  date: Date;
}

const hours = Array.from({ length: 24 }, (_, i) => i);

export function DayColumn(props: DayColumnProps) {
  const isWeekend = () => {
    const day = props.date.getDay();
    return day === 0 || day === 6;
  };

  const isToday = () => {
    const today = new Date();
    return (
      props.date.getDate() === today.getDate() &&
      props.date.getMonth() === today.getMonth() &&
      props.date.getFullYear() === today.getFullYear()
    );
  };

  // Calculate current time indicator position
  const getCurrentTimePosition = () => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const totalMinutes = hours * 60 + minutes;
    const hourHeight = 48; // matches --grid-hour-height
    return (totalMinutes / 60) * hourHeight;
  };

  return (
    <div
      class="flex-1 min-w-0 border-l border-[#e8e8e8] first:border-l-0 relative"
      classList={{
        "bg-[#fafafa]": isWeekend(),
      }}
    >
      {/* Hour grid lines */}
      <For each={hours}>
        {(hour) => (
          <div
            class="h-[var(--grid-hour-height)] border-b border-[#e8e8e8]"
            style={{ height: "var(--grid-hour-height)" }}
          />
        )}
      </For>

      {/* Current time indicator - only show on today's column */}
      {isToday() && (
        <div
          class="absolute left-0 right-0 z-10 pointer-events-none"
          style={{ top: `${getCurrentTimePosition()}px` }}
        >
          {/* Red dot */}
          <div class="absolute -left-1.5 -top-1.5 w-3 h-3 bg-[#ea4335] rounded-full" />
          {/* Red line */}
          <div class="h-0.5 bg-[#ea4335]" />
        </div>
      )}
    </div>
  );
}
