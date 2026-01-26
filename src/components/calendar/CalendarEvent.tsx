import { createSignal, Show } from "solid-js";
import { burnElement } from "../../hooks/useBurnAnimation";
import { deleteEvent } from "../../data/mockEvents";
import fireGif from "../../assets/fire.gif";
import type { EventLayoutInfo } from "../../utils/eventLayout";

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  color: string;
}

interface CalendarEventProps {
  event: CalendarEvent;
  layout?: EventLayoutInfo;
}

const HOUR_HEIGHT = 48; // matches --grid-hour-height
const CHIP_MARGIN_BOTTOM = 4; // gap at bottom of events

function formatTime(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;

  if (minutes === 0) {
    return `${displayHour}${period}`;
  }
  return `${displayHour}:${minutes.toString().padStart(2, "0")}${period}`;
}

function formatTimeRange(start: Date, end: Date): string {
  return `${formatTime(start)} – ${formatTime(end)}`;
}

export function CalendarEvent(props: CalendarEventProps) {
  let contentRef: HTMLDivElement | undefined;
  const [isBurning, setIsBurning] = createSignal(false);
  const [firePosition, setFirePosition] = createSignal(0);
  const [isFocused, setIsFocused] = createSignal(false);

  const getPosition = () => {
    const startHours = props.event.start.getHours();
    const startMinutes = props.event.start.getMinutes();
    return (startHours + startMinutes / 60) * HOUR_HEIGHT;
  };

  const getHeight = () => {
    const startMs = props.event.start.getTime();
    const endMs = props.event.end.getTime();
    const durationHours = (endMs - startMs) / (1000 * 60 * 60);
    const rawHeight = durationHours * HOUR_HEIGHT - CHIP_MARGIN_BOTTOM;
    return Math.max(rawHeight, 24); // minimum height of 24px
  };

  // Calculate max lines for title based on available height
  // Height minus padding (8px top+bottom) minus time row (~14px) = title area
  // Line height for text-xs leading-tight ≈ 15px
  const getTitleMaxLines = () => {
    const titleAreaHeight = getHeight() - 8 - 14;
    return Math.max(1, Math.floor(titleAreaHeight / 15));
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

  // Get layout-aware positioning
  const getLeft = () => props.layout?.left ?? "4px";
  const getWidth = () => props.layout?.width ?? "calc(100% - 8px)";
  const getZIndex = () => (isFocused() ? 100 : (props.layout?.zIndex ?? 1));

  return (
    // Outer wrapper - positioned, not clipped
    <div
      ref={setWrapperRef}
      data-event-id={props.event.id}
      class="absolute"
      style={{
        top: `${getPosition()}px`,
        height: `${getHeight()}px`,
        left: getLeft(),
        width: getWidth(),
        "z-index": getZIndex(),
      }}
    >
      {/* Content - this gets clipped during burn */}
      <div
        ref={contentRef}
        class="absolute inset-0 rounded-lg border-l-4  px-1 py-1 cursor-pointer transition-colors duration-75 calendar-event overflow-hidden"
        style={{
          "--event-color": props.event.color,
        }}
        tabIndex={0}
        role="button"
        aria-label={`${props.event.title}, ${formatTimeRange(props.event.start, props.event.end)}`}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
      >
        <Show
          when={getHeight() >= 28}
          fallback={
            <div class="truncate text-xs leading-tight font-medium">
              {props.event.title}
            </div>
          }
        >
          <div
            class="text-xs font-medium leading-tight overflow-hidden"
            style={{
              display: "-webkit-box",
              "-webkit-box-orient": "vertical",
              "-webkit-line-clamp": getTitleMaxLines(),
            }}
          >
            {props.event.title}
          </div>
          <div class="text-[10px] font-light mt-0.5 opacity-80 whitespace-nowrap">
            {getHeight() < 32 ? formatTime(props.event.start) : formatTimeRange(props.event.start, props.event.end)}
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
