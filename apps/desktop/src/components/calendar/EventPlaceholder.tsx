import { Show, createMemo } from "solid-js";
import {
  isCreating,
  draftStart,
  draftEnd,
  draftTitle,
  getDraftColor,
} from "../../stores/event-creation";
import {
  HOUR_HEIGHT_PX,
  EVENT_MARGIN_X_PX,
  EVENT_MARGIN_TOTAL_PX,
  EVENT_MARGIN_BOTTOM_PX,
  MIN_EVENT_HEIGHT_PX,
  MS_PER_HOUR,
} from "../../constants/calendar";

interface EventPlaceholderProps {
  date: Date;
}

export function EventPlaceholder(props: EventPlaceholderProps) {
  const isSameDay = (a: Date, b: Date) =>
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear();

  const isVisible = createMemo(() => {
    const start = draftStart();
    return isCreating() && start !== null && isSameDay(start, props.date);
  });

  const getTop = () => {
    const start = draftStart();
    if (!start) return 0;
    return (start.getHours() + start.getMinutes() / 60) * HOUR_HEIGHT_PX;
  };

  const getHeight = () => {
    const start = draftStart();
    const end = draftEnd();
    if (!start || !end) return MIN_EVENT_HEIGHT_PX;
    const durationMs = end.getTime() - start.getTime();
    const rawHeight = (durationMs / MS_PER_HOUR) * HOUR_HEIGHT_PX - EVENT_MARGIN_BOTTOM_PX;
    return Math.max(rawHeight, MIN_EVENT_HEIGHT_PX);
  };

  const formatTime = (date: Date): string => {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const period = hours >= 12 ? "PM" : "AM";
    const displayHour = hours % 12 || 12;
    if (minutes === 0) return `${displayHour}${period}`;
    return `${displayHour}:${minutes.toString().padStart(2, "0")}${period}`;
  };

  return (
    <Show when={isVisible()}>
      <div
        class="absolute rounded-lg overflow-hidden"
        style={{
          top: `${getTop()}px`,
          height: `${getHeight()}px`,
          left: `${EVENT_MARGIN_X_PX}px`,
          width: `calc(100% - ${EVENT_MARGIN_TOTAL_PX}px)`,
          "background-color": getDraftColor(),
          opacity: "0.3",
          "z-index": "50",
        }}
      >
        <div class="flex h-full">
          <div class="w-1 shrink-0" style={{ "background-color": getDraftColor() }} />
          <div class="flex-1 min-w-0 px-1 py-1">
            <Show when={draftTitle().trim()}>
              <div class="text-xs font-medium leading-tight truncate" style={{ opacity: "1" }}>
                {draftTitle()}
              </div>
            </Show>
            <Show when={draftStart() && draftEnd()}>
              <div class="text-[10px] font-light mt-0.5 whitespace-nowrap" style={{ opacity: "0.8" }}>
                {formatTime(draftStart()!)} – {formatTime(draftEnd()!)}
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
