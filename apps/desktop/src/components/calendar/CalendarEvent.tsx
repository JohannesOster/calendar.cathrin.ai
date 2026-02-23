import { createSignal, Show, createMemo, onCleanup } from "solid-js";
import { burnElement } from "../../lib/animations/burn";
import fireGif from "../../assets/fire.gif";
import type { EventLayoutInfo } from "../../utils/eventLayout";
import type { CalendarEvent as CalendarEventData } from "../../stores/event-types";
import { deleteEvent } from "../../stores/event-deletion";
import { selectEvent, selectedEventId } from "../../stores/event-selection";
import { startMoveDrag, startResizeDrag, dragActiveEventId } from "../../stores/event-drag";
import { snapMinutes } from "../../stores/event-creation";
import { isPendingNotification } from "../../stores/pending-notifications";
import { isBuffered } from "../../stores/buffered-attendees";
import { currentMinute } from "../../stores/current-time";
import { Users, Repeat } from "lucide-solid";
import { formatCompactTime, formatTimeRange, getTimezoneAbbr } from "../../lib/format-utils";

// Shared signal: all segments of the focused event highlight together
export const [focusedEventId, setFocusedEventId] = createSignal<string | null>(null);
import {
  HOUR_HEIGHT_PX,
  EVENT_MARGIN_BOTTOM_PX,
  EVENT_MARGIN_LEFT_PX,
  EVENT_MARGIN_TOTAL_PX,
  MIN_EVENT_HEIGHT_PX,
  SINGLE_LINE_THRESHOLD_PX,
  SHORT_TIME_THRESHOLD_PX,
  TITLE_LINE_HEIGHT_PX,
  TIME_ROW_HEIGHT_PX,
  EVENT_PADDING_Y_PX,
  FOCUSED_Z_INDEX,
  MS_PER_HOUR,
  TOTAL_GRID_HEIGHT_PX,
  SYSTEM_TIMEZONE,
} from "../../constants/calendar";

interface CalendarEventProps {
  event: CalendarEventData;
  layout?: EventLayoutInfo;
  columnDate?: Date;
}

export function CalendarEvent(props: CalendarEventProps) {
  let contentRef: HTMLDivElement | undefined;
  const [isBurning, setIsBurning] = createSignal(false);
  const [firePosition, setFirePosition] = createSignal(0);
  const isFocused = createMemo(() => focusedEventId() === props.event.id);
  const isSelected = createMemo(() => selectedEventId() === props.event.id);
  const isBeingDragged = createMemo(() => dragActiveEventId() === props.event.id);
  const selfResponse = createMemo(() => props.event.attendees?.find(a => a.isSelf)?.responseStatus);
  const hasPendingNotification = createMemo(() => isPendingNotification(props.event.id) || isBuffered(props.event.id));
  const isPast = createMemo(() => props.event.end.getTime() < currentMinute().getTime());

  /** Threshold in px for click-vs-drag detection */
  const MOVE_DRAG_THRESHOLD = 3;
  let cleanupDragDetection: (() => void) | null = null;

  const handleResizePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (props.event.isAllDay) return;
    if (props.event.isReadOnly) return;

    const startY = e.clientY;
    let started = false;

    const onMove = (me: PointerEvent) => {
      if (!started && Math.abs(me.clientY - startY) >= MOVE_DRAG_THRESHOLD) {
        started = true;
        startResizeDrag(props.event);
      }
    };

    const onUp = () => {
      cleanup();
    };

    const cleanup = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    e.preventDefault();
    e.stopPropagation();
  };

  const handlePointerDown = (e: PointerEvent) => {
    // Only left button, only single-day timed events
    if (e.button !== 0) return;
    if (props.event.isAllDay) return;

    // Read-only events: click-to-select only, no drag
    if (props.event.isReadOnly) {
      e.preventDefault();
      contentRef?.focus();
      selectEvent(props.event.id, contentRef);
      return;
    }

    // Don't start move drag from the resize handle
    const target = e.target as HTMLElement;
    if (target.closest("[data-resize-handle]")) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;

    const onMove = (me: PointerEvent) => {
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;
      if (!started && Math.sqrt(dx * dx + dy * dy) >= MOVE_DRAG_THRESHOLD) {
        started = true;

        // Calculate cursor time offset within the event
        const dayCol = contentRef?.closest("[data-day-column]") as HTMLElement | null;
        if (!dayCol) return;
        const rect = dayCol.getBoundingClientRect();
        const mouseY = startY - rect.top;
        const cursorMinutes = snapMinutes(Math.max(0, (mouseY / HOUR_HEIGHT_PX) * 60));

        startMoveDrag(props.event, cursorMinutes);
      }
    };

    const onUp = () => {
      cleanup();
      if (!started) {
        // Was a click, not a drag — select + focus the event
        // (preventDefault on pointerdown suppresses native focus)
        contentRef?.focus();
        selectEvent(props.event.id, contentRef);
      }
    };

    const cleanup = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      cleanupDragDetection = null;
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    cleanupDragDetection = cleanup;
    e.preventDefault();
    e.stopPropagation();
  };

  onCleanup(() => cleanupDragDetection?.());

  const isSameDay = (a: Date, b: Date) =>
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear();

  /** Determine which segment of a multi-day event this column represents */
  const segment = createMemo((): "only" | "first" | "middle" | "last" => {
    const col = props.columnDate;
    if (!col || isSameDay(props.event.start, props.event.end)) return "only";
    if (isSameDay(col, props.event.start)) return "first";
    if (isSameDay(col, props.event.end)) return "last";
    return "middle";
  });

  const position = createMemo(() => {
    const seg = segment();
    if (seg === "middle" || seg === "last") return 0;
    const startHours = props.event.start.getHours();
    const startMinutes = props.event.start.getMinutes();
    return (startHours + startMinutes / 60) * HOUR_HEIGHT_PX;
  });

  const height = createMemo(() => {
    const seg = segment();

    if (seg === "only") {
      const durationMs = props.event.end.getTime() - props.event.start.getTime();
      const rawHeight = (durationMs / MS_PER_HOUR) * HOUR_HEIGHT_PX - EVENT_MARGIN_BOTTOM_PX;
      return Math.max(rawHeight, MIN_EVENT_HEIGHT_PX);
    }
    if (seg === "first") {
      const startMinutes = props.event.start.getHours() * 60 + props.event.start.getMinutes();
      const rawHeight = ((24 * 60 - startMinutes) / 60) * HOUR_HEIGHT_PX - EVENT_MARGIN_BOTTOM_PX;
      return Math.max(rawHeight, MIN_EVENT_HEIGHT_PX);
    }
    if (seg === "last") {
      const endMinutes = props.event.end.getHours() * 60 + props.event.end.getMinutes();
      const rawHeight = (endMinutes / 60) * HOUR_HEIGHT_PX - EVENT_MARGIN_BOTTOM_PX;
      return Math.max(rawHeight, MIN_EVENT_HEIGHT_PX);
    }
    // middle: full 24h grid
    return TOTAL_GRID_HEIGHT_PX - EVENT_MARGIN_BOTTOM_PX;
  });

  const titleMaxLines = createMemo(() => {
    const titleAreaHeight = height() - EVENT_PADDING_Y_PX - TIME_ROW_HEIGHT_PX;
    return Math.max(1, Math.floor(titleAreaHeight / TITLE_LINE_HEIGHT_PX));
  });

  // Exposed method to trigger the burn animation
  const triggerBurn = () => {
    if (isBurning() || !contentRef) return;
    if (props.event.isReadOnly) return;

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
  const left = createMemo(() => props.layout?.left ?? `${EVENT_MARGIN_LEFT_PX}px`);
  const width = createMemo(() => props.layout?.width ?? `calc(100% - ${EVENT_MARGIN_TOTAL_PX}px)`);
  const zIndex = createMemo(() => (isFocused() || isSelected() ? FOCUSED_Z_INDEX : (props.layout?.zIndex ?? 1)));
  const hasOverlap = createMemo(() => props.layout?.overlaps ?? false);

  const showTzIndicator = () =>
    !props.event.isAllDay && !!props.event.timeZone && props.event.timeZone !== SYSTEM_TIMEZONE;

  const tzAbbr = createMemo(() =>
    showTzIndicator() ? getTimezoneAbbr(props.event.start, props.event.timeZone!) : ""
  );

  return (
    // Outer wrapper - positioned, not clipped
    <div
      ref={setWrapperRef}
      data-event-id={props.event.id}
      class="absolute"
      style={{
        top: `${position()}px`,
        height: `${height()}px`,
        left: left(),
        width: width(),
        "z-index": zIndex(),
      }}
    >
      {/* Outer container - rounded corners, box-shadow border, clips inner content */}
      <div
        ref={contentRef}
        class={`absolute inset-0 rounded-md transition-[background-color,color,box-shadow] duration-75 calendar-event overflow-hidden ${hasOverlap() ? "calendar-event--overlapping" : ""} ${isFocused() ? "calendar-event--focused" : ""} ${isSelected() ? "calendar-event--selected" : ""} ${isBeingDragged() ? "calendar-event--dragging" : ""} ${isPast() ? "calendar-event--past" : ""} ${selfResponse() === "needsAction" ? "calendar-event--needs-action" : ""} ${selfResponse() === "tentative" ? "calendar-event--tentative" : ""} ${props.event.isReadOnly ? "cursor-default" : props.event.isAllDay ? "cursor-pointer" : "cursor-grab"}`}
        style={{
          "--event-color": props.event.color,
        }}
        tabIndex={0}
        role="button"
        aria-label={`${props.event.title}, ${formatTimeRange(props.event.start, props.event.end)}${showTzIndicator() ? ` ${tzAbbr()}` : ""}${props.event.recurringEventId || props.event.recurrence ? ", recurring" : ""}${props.event.isReadOnly ? ", view only" : ""}`}
        aria-selected={isSelected()}
        onFocus={() => setFocusedEventId(props.event.id)}
        onBlur={() => setFocusedEventId((prev) => prev === props.event.id ? null : prev)}
        onPointerDown={handlePointerDown}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectEvent(props.event.id, contentRef);
          }
        }}
      >
        {/* Inner layout - content fills the chip */}
        <div class="h-full">
          <div class="min-w-0 pl-3 pr-1.5 py-1">
            <Show
              when={height() >= SINGLE_LINE_THRESHOLD_PX}
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
                  "-webkit-line-clamp": titleMaxLines(),
                }}
              >
                {props.event.title}
              </div>
              <div class="flex items-center gap-1 text-2xs font-light mt-0.5 opacity-80 whitespace-nowrap">
                <span>
                  {height() < SHORT_TIME_THRESHOLD_PX
                    ? formatCompactTime(props.event.start, props.event.timeZone)
                    : formatTimeRange(props.event.start, props.event.end, props.event.timeZone)}
                </span>
                <Show when={props.event.recurringEventId || props.event.recurrence}>
                  <Repeat size={10} aria-hidden="true" />
                </Show>
                <Show when={props.event.attendees && props.event.attendees.length > 1}>
                  <span
                    class="inline-flex items-center gap-0.5"
                    aria-label={`${props.event.attendees!.length} participants`}
                  >
                    <Users size={10} aria-hidden="true" />
                    <Show when={height() >= SHORT_TIME_THRESHOLD_PX}>
                      {props.event.attendees!.length}
                    </Show>
                  </span>
                </Show>
              </div>
              <Show when={showTzIndicator()}>
                <div class="text-2xs font-light opacity-60">
                  {tzAbbr()}
                </div>
              </Show>
            </Show>
          </div>
        </div>

        {/* Resize handle — bottom edge, visible on hover (hidden for read-only) */}
        <Show when={!props.event.isAllDay && !props.event.isReadOnly}>
          <div
            data-resize-handle
            class="calendar-event__resize-handle"
            aria-label="Resize event duration"
            onPointerDown={handleResizePointerDown}
          />
        </Show>
      </div>

      {/* Pending notification dot indicator */}
      <Show when={hasPendingNotification()}>
        <div
          class="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-accent z-[2]"
          aria-label="Invitations not sent"
        />
      </Show>

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
