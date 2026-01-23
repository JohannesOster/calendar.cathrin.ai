interface DayColumnProps {
  date: Date;
}

// Total height: 24 hours × 48px = 1152px
const TOTAL_HEIGHT = 24 * 48;

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
