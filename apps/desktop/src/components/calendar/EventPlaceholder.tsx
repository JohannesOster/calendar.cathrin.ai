import { Show, createMemo } from "solid-js";
import {
  isCreating,
  draftStart,
  draftEnd,
  draftTitle,
  draftIsAllDay,
  getDraftColor,
  shadowStart,
  shadowEnd,
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
  TOTAL_GRID_HEIGHT_PX,
} from "../../constants/calendar";

interface EventPlaceholderProps {
  date: Date;
}

export function EventPlaceholder(props: EventPlaceholderProps) {
  const toMidnight = (d: Date) => {
    const m = new Date(d);
    m.setHours(0, 0, 0, 0);
    return m;
  };

  /** Where this column's date falls relative to the draft range */
  const segment = createMemo<"none" | "only" | "first" | "middle" | "last">(() => {
    const start = draftStart();
    const end = draftEnd();
    if (!isCreating() || !start || !end || draftIsAllDay()) return "none";

    const colDay = toMidnight(props.date).getTime();
    const startDay = toMidnight(start).getTime();

    // For the end day: if end is exactly midnight, the event doesn't occupy
    // that day (0 duration on that day), so pull back by 1ms for the check.
    const endTime = end.getTime();
    const endForRange = end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0
      ? endTime - 1
      : endTime;
    const endDay = toMidnight(new Date(endForRange)).getTime();

    if (colDay < startDay || colDay > endDay) return "none";
    if (startDay === endDay) return "only";
    if (colDay === startDay) return "first";
    if (colDay === endDay) return "last";
    return "middle";
  });

  const isVisible = createMemo(() => segment() !== "none");

  const hasTitle = () => draftTitle().trim().length > 0;

  const getTop = () => {
    const seg = segment();
    if (seg === "middle" || seg === "last") return 0;
    const start = draftStart();
    if (!start) return 0;
    return (start.getHours() + start.getMinutes() / 60) * HOUR_HEIGHT_PX;
  };

  const getHeight = () => {
    const seg = segment();
    const start = draftStart();
    const end = draftEnd();
    if (!start || !end) return MIN_EVENT_HEIGHT_PX;

    const bottomMargin = hasTitle() ? EVENT_MARGIN_BOTTOM_PX : 0;

    if (seg === "only") {
      // Single-day: same as before
      const durationMs = end.getTime() - start.getTime();
      const rawHeight = (durationMs / MS_PER_HOUR) * HOUR_HEIGHT_PX - bottomMargin;
      return Math.max(rawHeight, MIN_EVENT_HEIGHT_PX);
    }
    if (seg === "first") {
      // From start time to bottom of grid (midnight)
      const startMinutes = start.getHours() * 60 + start.getMinutes();
      const rawHeight = ((24 * 60 - startMinutes) / 60) * HOUR_HEIGHT_PX - bottomMargin;
      return Math.max(rawHeight, MIN_EVENT_HEIGHT_PX);
    }
    if (seg === "last") {
      // From top of grid (midnight) to end time
      const endMinutes = end.getHours() * 60 + end.getMinutes();
      const rawHeight = (endMinutes / 60) * HOUR_HEIGHT_PX - bottomMargin;
      return Math.max(rawHeight, MIN_EVENT_HEIGHT_PX);
    }
    // middle: full 24h grid
    return TOTAL_GRID_HEIGHT_PX - bottomMargin;
  };

  /** Only show title/time labels on the first segment */
  const isFirstSegment = () => {
    const seg = segment();
    return seg === "only" || seg === "first";
  };

  const formatTime = (date: Date): string => {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const period = hours >= 12 ? "PM" : "AM";
    const displayHour = hours % 12 || 12;
    if (minutes === 0) return `${displayHour}${period}`;
    return `${displayHour}:${minutes.toString().padStart(2, "0")}${period}`;
  };

  // Shadow segment: shows where the event WAS before inline time editing
  const shadowSegment = createMemo<"none" | "only" | "first" | "middle" | "last">(() => {
    const start = shadowStart();
    const end = shadowEnd();
    if (!isCreating() || !start || !end || draftIsAllDay()) return "none";

    const colDay = toMidnight(props.date).getTime();
    const startDay = toMidnight(start).getTime();
    const endTime = end.getTime();
    const endForRange = end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0
      ? endTime - 1
      : endTime;
    const endDay = toMidnight(new Date(endForRange)).getTime();

    if (colDay < startDay || colDay > endDay) return "none";
    if (startDay === endDay) return "only";
    if (colDay === startDay) return "first";
    if (colDay === endDay) return "last";
    return "middle";
  });

  const shadowVisible = createMemo(() => shadowSegment() !== "none");

  const getShadowTop = () => {
    const seg = shadowSegment();
    if (seg === "middle" || seg === "last") return 0;
    const start = shadowStart();
    if (!start) return 0;
    return (start.getHours() + start.getMinutes() / 60) * HOUR_HEIGHT_PX;
  };

  const getShadowHeight = () => {
    const seg = shadowSegment();
    const start = shadowStart();
    const end = shadowEnd();
    if (!start || !end) return MIN_EVENT_HEIGHT_PX;

    if (seg === "only") {
      const durationMs = end.getTime() - start.getTime();
      const rawHeight = (durationMs / MS_PER_HOUR) * HOUR_HEIGHT_PX;
      return Math.max(rawHeight, MIN_EVENT_HEIGHT_PX);
    }
    if (seg === "first") {
      const startMinutes = start.getHours() * 60 + start.getMinutes();
      return Math.max(((24 * 60 - startMinutes) / 60) * HOUR_HEIGHT_PX, MIN_EVENT_HEIGHT_PX);
    }
    if (seg === "last") {
      const endMinutes = end.getHours() * 60 + end.getMinutes();
      return Math.max((endMinutes / 60) * HOUR_HEIGHT_PX, MIN_EVENT_HEIGHT_PX);
    }
    return TOTAL_GRID_HEIGHT_PX;
  };

  return (
    <>
    {/* Shadow/ghost at original position during inline time editing */}
    <Show when={shadowVisible()}>
      <div
        class="absolute rounded-md pointer-events-none"
        style={{
          top: `${getShadowTop()}px`,
          height: `${getShadowHeight()}px`,
          left: `${EVENT_MARGIN_LEFT_PX}px`,
          width: `calc(100% - ${EVENT_MARGIN_TOTAL_PX}px)`,
          "background-color": getDraftColor(),
          opacity: "0.15",
          "z-index": "49",
          border: `1px dashed ${getDraftColor()}`,
        }}
      />
    </Show>
    <Show when={isVisible()}>
      <div
        data-event-placeholder
        class="absolute rounded-md overflow-hidden"
        classList={{ "calendar-event": hasTitle() && isFirstSegment() }}
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
        <div class="h-full">
          <div class="min-w-0 px-1.5 py-1">
            <Show when={isFirstSegment()}>
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
                  <div class="text-2xs font-light mt-0.5 whitespace-nowrap" style={{ opacity: "0.8" }}>
                    {getHeight() < SHORT_TIME_THRESHOLD_PX ? formatTime(draftStart()!) : `${formatTime(draftStart()!)} – ${formatTime(draftEnd()!)}`}
                  </div>
                </Show>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Show>
    </>
  );
}
