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
  EVENT_MARGIN_LEFT_PX,
  EVENT_MARGIN_TOTAL_PX,
  EVENT_MARGIN_BOTTOM_PX,
  MIN_EVENT_HEIGHT_PX,
  MS_PER_HOUR,
  SINGLE_LINE_THRESHOLD_PX,
  SHORT_TIME_THRESHOLD_PX,
  TITLE_LINE_HEIGHT_PX,
  TIME_ROW_HEIGHT_PX,
  EVENT_PADDING_Y_PX,
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

  const hasTitle = () => draftTitle().trim().length > 0;

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
    const rawHeight = (durationMs / MS_PER_HOUR) * HOUR_HEIGHT_PX - (hasTitle() ? EVENT_MARGIN_BOTTOM_PX : 0);
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
        data-event-placeholder
        class="absolute rounded-lg overflow-hidden"
        classList={{ "calendar-event": hasTitle() }}
        style={{
          top: `${getTop()}px`,
          height: `${getHeight()}px`,
          left: `${EVENT_MARGIN_LEFT_PX}px`,
          width: `calc(100% - ${EVENT_MARGIN_TOTAL_PX}px)`,
          ...(hasTitle()
            ? {
                "--event-color": getDraftColor(),
                "background-color": getDraftColor(),
                color: "white",
                "z-index": "50",
              }
            : {
                "background-color": getDraftColor(),
                opacity: "0.3",
                "z-index": "50",
              }),
        }}
      >
        <div class="flex h-full">
          <div
            class="w-1 shrink-0"
            classList={{ "calendar-event__ribbon": hasTitle() }}
            style={hasTitle() ? {} : { "background-color": getDraftColor() }}
          />
          <div class="flex-1 min-w-0 px-1 py-1">
            <Show
              when={getHeight() >= SINGLE_LINE_THRESHOLD_PX}
              fallback={
                <Show when={hasTitle()}>
                  <div class="truncate text-xs leading-tight font-medium">
                    {draftTitle()}
                  </div>
                </Show>
              }
            >
              <Show when={hasTitle()}>
                <div
                  class="text-xs font-medium leading-tight overflow-hidden"
                  style={{
                    display: "-webkit-box",
                    "-webkit-box-orient": "vertical",
                    "-webkit-line-clamp": Math.max(1, Math.floor((getHeight() - EVENT_PADDING_Y_PX - TIME_ROW_HEIGHT_PX) / TITLE_LINE_HEIGHT_PX)),
                  }}
                >
                  {draftTitle()}
                </div>
              </Show>
              <Show when={hasTitle() && draftStart() && draftEnd()}>
                <div class="text-[10px] font-light mt-0.5 whitespace-nowrap" style={{ opacity: "0.8" }}>
                  {getHeight() < SHORT_TIME_THRESHOLD_PX ? formatTime(draftStart()!) : `${formatTime(draftStart()!)} – ${formatTime(draftEnd()!)}`}
                </div>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
