export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  color: string;
}

interface CalendarEventProps {
  event: CalendarEvent;
}

const HOUR_HEIGHT = 48; // matches --grid-hour-height

function formatTimeRange(start: Date, end: Date): string {
  const formatTime = (date: Date) => {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const period = hours >= 12 ? "PM" : "AM";
    const displayHour = hours % 12 || 12;

    if (minutes === 0) {
      return `${displayHour}${period}`;
    }
    return `${displayHour}:${minutes.toString().padStart(2, "0")}${period}`;
  };

  return `${formatTime(start)} – ${formatTime(end)}`;
}

export function CalendarEvent(props: CalendarEventProps) {
  const getPosition = () => {
    const startHours = props.event.start.getHours();
    const startMinutes = props.event.start.getMinutes();
    return (startHours + startMinutes / 60) * HOUR_HEIGHT;
  };

  const getHeight = () => {
    const startMs = props.event.start.getTime();
    const endMs = props.event.end.getTime();
    const durationHours = (endMs - startMs) / (1000 * 60 * 60);
    return Math.max(durationHours * HOUR_HEIGHT, 24); // minimum height of 24px
  };

  return (
    <div
      class="absolute left-1 right-1 rounded-lg border-l-4 px-2 py-1 overflow-hidden cursor-pointer hover:brightness-95 transition-[filter]"
      style={{
        top: `${getPosition()}px`,
        height: `${getHeight()}px`,
        "background-color": `${props.event.color}33`,
        "border-color": props.event.color,
      }}
    >
      <div
        class="text-xs font-medium line-clamp-2 leading-tight"
        style={{ color: props.event.color }}
      >
        {props.event.title}
      </div>
      <div
        class="text-xs font-light mt-0.5"
        style={{ color: props.event.color }}
      >
        {formatTimeRange(props.event.start, props.event.end)}
      </div>
    </div>
  );
}
