import { createSignal, Show } from "solid-js";
import { burnElement } from "../../hooks/useBurnAnimation";
import { deleteEvent } from "../../data/mockEvents";
import fireGif from "../../assets/fire.gif";
import type { EventLayoutInfo } from "../../utils/eventLayout";
import type { CalendarEvent } from "../../stores/events";

// Re-export for backward compatibility
export type { CalendarEvent };
import {
  HOUR_HEIGHT_PX,
  EVENT_MARGIN_BOTTOM_PX,
  EVENT_MARGIN_X_PX,
  EVENT_MARGIN_TOTAL_PX,
  MIN_EVENT_HEIGHT_PX,
  SINGLE_LINE_THRESHOLD_PX,
  SHORT_TIME_THRESHOLD_PX,
  TITLE_LINE_HEIGHT_PX,
  TIME_ROW_HEIGHT_PX,
  EVENT_PADDING_Y_PX,
  FOCUSED_Z_INDEX,
  MS_PER_HOUR,
} from "../../constants/calendar";

interface CalendarEventProps {
  event: CalendarEvent;
  layout?: EventLayoutInfo;
}

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
    return (startHours + startMinutes / 60) * HOUR_HEIGHT_PX;
  };

  const getHeight = () => {
    const startMs = props.event.start.getTime();
    const endMs = props.event.end.getTime();
    const durationMs = endMs - startMs;
    const rawHeight = (durationMs / MS_PER_HOUR) * HOUR_HEIGHT_PX - EVENT_MARGIN_BOTTOM_PX;
    return Math.max(rawHeight, MIN_EVENT_HEIGHT_PX);
  };

  const getTitleMaxLines = () => {
    const titleAreaHeight = getHeight() - EVENT_PADDING_Y_PX - TIME_ROW_HEIGHT_PX;
    return Math.max(1, Math.floor(titleAreaHeight / TITLE_LINE_HEIGHT_PX));
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
  const getLeft = () => props.layout?.left ?? `${EVENT_MARGIN_X_PX}px`;
  const getWidth = () => props.layout?.width ?? `calc(100% - ${EVENT_MARGIN_TOTAL_PX}px)`;
  const getZIndex = () => (isFocused() ? FOCUSED_Z_INDEX : (props.layout?.zIndex ?? 1));
  const hasOverlap = () => props.layout?.overlaps ?? false;

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
        class={`absolute inset-0 rounded-lg border-l-4 px-1 py-1 cursor-pointer transition-colors duration-75 calendar-event overflow-hidden ${hasOverlap() ? "calendar-event--overlapping" : ""}`}
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
          when={getHeight() >= SINGLE_LINE_THRESHOLD_PX}
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
            {getHeight() < SHORT_TIME_THRESHOLD_PX ? formatTime(props.event.start) : formatTimeRange(props.event.start, props.event.end)}
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
