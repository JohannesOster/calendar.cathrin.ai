import { createSignal, Show } from "solid-js";
import { burnElement } from "../../hooks/useBurnAnimation";
import { deleteEvent } from "../../data/mockEvents";
import fireGif from "../../assets/fire.gif";

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
  let contentRef: HTMLDivElement | undefined;
  const [isBurning, setIsBurning] = createSignal(false);
  const [firePosition, setFirePosition] = createSignal(0);

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

  // Exposed method to trigger the burn animation
  const triggerBurn = () => {
    if (isBurning() || !contentRef) return;

    setIsBurning(true);
    contentRef.blur();

    burnElement(contentRef, setFirePosition, () => {
      deleteEvent(props.event.id);
    });
  };

  // Expose triggerBurn on the wrapper element for external access
  const setWrapperRef = (el: HTMLDivElement) => {
    (el as any).triggerBurn = triggerBurn;
    (el as any).eventId = props.event.id;
  };

  return (
    // Outer wrapper - positioned, not clipped
    <div
      ref={setWrapperRef}
      data-event-id={props.event.id}
      class="absolute left-1 right-1"
      style={{
        top: `${getPosition()}px`,
        height: `${getHeight()}px`,
      }}
    >
      {/* Content - this gets clipped during burn */}
      <div
        ref={contentRef}
        class="absolute inset-0 rounded-lg border-l-4 px-2 py-1 cursor-pointer transition-colors calendar-event overflow-hidden"
        style={{
          "--event-color": props.event.color,
        }}
        tabIndex={0}
        role="button"
        aria-label={`${props.event.title}, ${formatTimeRange(props.event.start, props.event.end)}`}
      >
        <Show
          when={getHeight() >= 40}
          fallback={
            <div class="truncate text-xs leading-tight">
              <span class="font-medium">
                {props.event.title}
              </span>
              <span class="text-[10px] font-light ml-1.5 opacity-80">
                {formatTimeRange(props.event.start, props.event.end)}
              </span>
            </div>
          }
        >
          <div class="text-xs font-medium line-clamp-2 leading-tight">
            {props.event.title}
          </div>
          <div class="text-[10px] font-light mt-0.5 opacity-80">
            {formatTimeRange(props.event.start, props.event.end)}
          </div>
        </Show>
      </div>

      {/* Fire GIF overlay - sibling to content, not clipped */}
      <Show when={isBurning()}>
        <img
          src={fireGif}
          alt=""
          class="absolute left-0 w-full pointer-events-none"
          style={{
            top: `${firePosition()}%`,
            height: "60px",
            transform: "translateY(-90%)",
            "z-index": 10,
          }}
        />
      </Show>
    </div>
  );
}
