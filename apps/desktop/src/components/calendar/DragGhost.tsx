import { createMemo, Show } from "solid-js";
import { moveDrag, resizeDrag } from "../../stores/event-drag";
import {
  HOUR_HEIGHT_PX,
  EVENT_MARGIN_LEFT_PX,
  EVENT_MARGIN_TOTAL_PX,
  MIN_EVENT_HEIGHT_PX,
  MS_PER_HOUR,
  TOTAL_GRID_HEIGHT_PX,
} from "../../constants/calendar";

interface DragGhostProps {
  date: Date;
}

/**
 * Ghost outline at the original position during drag-to-move or drag-to-resize.
 * Mirrors the shadow pattern from EventPlaceholder (creation flow).
 */
export function DragGhost(props: DragGhostProps) {
  const toMidnight = (d: Date) => {
    const m = new Date(d);
    m.setHours(0, 0, 0, 0);
    return m;
  };

  const dragInfo = createMemo(() => {
    const move = moveDrag();
    if (move) {
      return {
        originalStart: move.originalStart,
        originalEnd: move.originalEnd,
        color: move.event.color,
      };
    }
    const resize = resizeDrag();
    if (resize) {
      return {
        originalStart: resize.originalStart,
        originalEnd: resize.originalEnd,
        color: resize.event.color,
      };
    }
    return null;
  });

  const segment = createMemo<"none" | "only" | "first" | "middle" | "last">(() => {
    const info = dragInfo();
    if (!info) return "none";

    const colDay = toMidnight(props.date).getTime();
    const startDay = toMidnight(info.originalStart).getTime();
    const endTime = info.originalEnd.getTime();
    const endForRange =
      info.originalEnd.getHours() === 0 &&
      info.originalEnd.getMinutes() === 0 &&
      info.originalEnd.getSeconds() === 0
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

  const getTop = () => {
    const seg = segment();
    if (seg === "middle" || seg === "last") return 0;
    const info = dragInfo();
    if (!info) return 0;
    const s = info.originalStart;
    return (s.getHours() + s.getMinutes() / 60) * HOUR_HEIGHT_PX;
  };

  const getHeight = () => {
    const seg = segment();
    const info = dragInfo();
    if (!info) return MIN_EVENT_HEIGHT_PX;

    const { originalStart: start, originalEnd: end } = info;

    if (seg === "only") {
      const durationMs = end.getTime() - start.getTime();
      return Math.max((durationMs / MS_PER_HOUR) * HOUR_HEIGHT_PX, MIN_EVENT_HEIGHT_PX);
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
    <Show when={isVisible()}>
      <div
        class="absolute rounded-lg pointer-events-none"
        style={{
          top: `${getTop()}px`,
          height: `${getHeight()}px`,
          left: `${EVENT_MARGIN_LEFT_PX}px`,
          width: `calc(100% - ${EVENT_MARGIN_TOTAL_PX}px)`,
          "background-color": dragInfo()!.color,
          opacity: "0.15",
          "z-index": "49",
          border: `1px dashed ${dragInfo()!.color}`,
        }}
      />
    </Show>
  );
}
