import { Show, onMount, onCleanup } from "solid-js";
import type { CalendarEvent } from "../../stores/event-types";
import { selectEvent } from "../../stores/event-selection";
import { selectedEventId } from "../../stores/event-selection";
import { formatDateRange, formatChipTimeRange, formatTimeRange } from "../../lib/format-utils";
import { ALL_DAY_ROW_HEIGHT, CHIP_BORDER_RADIUS } from "../../constants/layout";
import { startUnfoldDrag, startAllDayMoveDrag, dragActiveEventId } from "../../stores/event-drag";
import { revertingEventIds } from "../../stores/events";

/** Width in px of the edge hit zone for resize/unfold drag */
const EDGE_HIT_ZONE = 6;
/** Minimum px movement before treating as drag */
const DRAG_THRESHOLD = 3;
const MS_PER_DAY = 86_400_000;

interface AllDayEventChipProps {
  event: CalendarEvent;
  // Positioning (calculated by parent based on layout algorithm)
  left: number; // px from left edge of all-day section
  width: number; // px width of chip
  row: number; // which row (0-indexed) for stacking
  // Visual hints for spanning
  startsBeforeView: boolean; // Event starts before visible range
  endsAfterView: boolean; // Event ends after visible range
}

export function AllDayEventChip(props: AllDayEventChipProps) {
  let chipRef: HTMLDivElement | undefined;
  let cleanupDragDetection: (() => void) | null = null;

  // Determine border radius based on spanning
  const getBorderRadius = () => {
    const left = props.startsBeforeView ? "0" : CHIP_BORDER_RADIUS;
    const right = props.endsAfterView ? "0" : CHIP_BORDER_RADIUS;
    return `${left} ${right} ${right} ${left}`;
  };

  const isSelected = () => selectedEventId() === props.event.id;
  const isDragging = () => dragActiveEventId() === props.event.id;
  const isReverting = () => revertingEventIds().has(props.event.id);

  const hasTimes = () => !props.event.isAllDay;

  /** Detect which edge of the chip the pointer is near */
  const getEdge = (clientX: number): "start" | "end" | null => {
    if (!chipRef) return null;
    const rect = chipRef.getBoundingClientRect();
    if (clientX - rect.left < EDGE_HIT_ZONE) return "start";
    if (rect.right - clientX < EDGE_HIT_ZONE) return "end";
    return null;
  };

  const handlePointerMove = (e: PointerEvent) => {
    const edge = getEdge(e.clientX);
    if (chipRef) {
      chipRef.style.cursor = edge ? "col-resize" : "pointer";
    }
  };

  const handlePointerLeave = () => {
    if (chipRef) {
      chipRef.style.cursor = "pointer";
    }
  };

  const handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;

    // Edge drag: resize the day span (works for both all-day and multi-day timed)
    const edge = getEdge(e.clientX);
    if (edge) {
      const startX = e.clientX;
      let started = false;

      const onMove = (me: PointerEvent) => {
        if (!started && Math.abs(me.clientX - startX) >= DRAG_THRESHOLD) {
          started = true;
          startUnfoldDrag(props.event, edge);
        }
      };

      const onUp = () => {
        cleanup();
        if (!started) {
          chipRef?.focus();
          selectEvent(props.event.id);
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
      return;
    }

    // Body drag: move the entire event
    {
      const startX = e.clientX;
      let started = false;

      const onMove = (me: PointerEvent) => {
        if (!started && Math.abs(me.clientX - startX) >= DRAG_THRESHOLD) {
          started = true;
          const chipRect = chipRef!.getBoundingClientRect();
          const fraction = (startX - chipRect.left) / chipRect.width;
          const durationDays = Math.round(
            (props.event.end.getTime() - props.event.start.getTime()) / MS_PER_DAY,
          );
          const grabDayOffset = Math.max(0, Math.min(Math.floor(fraction * durationDays), durationDays - 1));
          startAllDayMoveDrag(props.event, grabDayOffset);
        }
      };

      const onUp = () => {
        cleanup();
        if (!started) {
          chipRef?.focus();
          selectEvent(props.event.id);
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
    }
  };

  // Auto-focus when mounting as the selected event — this happens after the
  // collapsed→expanded transition recreates the chip, restoring keyboard focus
  // so Delete/Backspace can trigger deletion.
  onMount(() => {
    if (isSelected()) {
      chipRef?.focus();
    }
  });

  onCleanup(() => cleanupDragDetection?.());

  const ariaLabel = () => {
    const type = hasTimes() ? "multi-day timed event" : "all-day event";
    const base = `${props.event.title}, ${type}, ${formatDateRange(props.event.start, props.event.end)}`;
    if (hasTimes()) return `${base}, ${formatTimeRange(props.event.start, props.event.end)}`;
    return base;
  };

  return (
    <div
      ref={chipRef}
      class="all-day-chip absolute flex items-center px-1.5 text-xs cursor-pointer truncate transition-[background-color]"
      classList={{
        "all-day-chip--selected": isSelected(),
      }}
      onClick={() => { chipRef?.focus(); selectEvent(props.event.id); }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      style={{
        left: "0",
        transform: `translateX(${props.left}px)`,
        width: `${props.width}px`,
        top: `${props.row * ALL_DAY_ROW_HEIGHT + 4}px`, // 4px top padding
        height: "var(--grid-all-day-chip-height)",
        "--event-color": props.event.color,
        "border-radius": getBorderRadius(),
        "z-index": isDragging() ? "10" : undefined,
        transition: isReverting() && !isDragging()
          ? "transform var(--duration-slow) ease-out, width var(--duration-slow) ease-out, top var(--duration-slow) ease-out, background-color var(--duration-fast)"
          : "background-color var(--duration-fast)",
      }}
      data-event-id={props.event.id}
      tabIndex={0}
      role="button"
      aria-label={ariaLabel()}
    >
      <div
        class="all-day-chip__ribbon absolute left-0 top-0 bottom-0 w-[3px]"
        style={{
          "background-color": props.event.color,
          "border-radius": `${props.startsBeforeView ? "0" : CHIP_BORDER_RADIUS} 0 0 ${props.startsBeforeView ? "0" : CHIP_BORDER_RADIUS}`,
        }}
      />
      <span class="truncate ml-0.5">{props.event.title}</span>
      <Show when={hasTimes()}>
        <span class="shrink-0 text-2xs opacity-50 ml-1">
          {formatChipTimeRange(props.event.start, props.event.end)}
        </span>
      </Show>
    </div>
  );
}
