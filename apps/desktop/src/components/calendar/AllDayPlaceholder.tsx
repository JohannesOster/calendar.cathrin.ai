import { Show, createMemo } from "solid-js";
import {
  isCreating,
  draftStart,
  draftEnd,
  draftTitle,
  draftIsAllDay,
  getDraftColor,
} from "../../stores/event-creation";
import { ALL_DAY_ROW_HEIGHT, CHIP_BORDER_RADIUS, CHIP_MARGIN_LEFT, CHIP_MARGIN_RIGHT } from "../../constants/layout";

interface DaySlot {
  date: Date;
  left: number;
}

interface AllDayPlaceholderProps {
  days: DaySlot[];
  colWidth: number;
  row: number;
}

export function AllDayPlaceholder(props: AllDayPlaceholderProps) {
  const placeholderLayout = createMemo(() => {
    if (!isCreating() || !draftIsAllDay()) return null;

    const start = draftStart();
    const end = draftEnd();
    if (!start || !end) return null;

    const days = props.days;
    if (days.length === 0) return null;

    // Find first and last day columns that overlap with the draft range
    // Draft dates are local; day slot dates are local midnight
    const startDay = new Date(start);
    startDay.setHours(0, 0, 0, 0);
    const endDay = new Date(end);
    endDay.setHours(0, 0, 0, 0);

    let firstCol: DaySlot | null = null;
    let lastCol: DaySlot | null = null;

    for (const day of days) {
      const dayMidnight = new Date(day.date);
      dayMidnight.setHours(0, 0, 0, 0);
      const dayTime = dayMidnight.getTime();

      if (dayTime >= startDay.getTime() && dayTime <= endDay.getTime()) {
        if (!firstCol) firstCol = day;
        lastCol = day;
      }
    }

    if (!firstCol || !lastCol) return null;

    const left = firstCol.left + CHIP_MARGIN_LEFT;
    const width = lastCol.left + props.colWidth - firstCol.left - CHIP_MARGIN_RIGHT - CHIP_MARGIN_LEFT;

    return { left, width };
  });

  const hasTitle = () => draftTitle().trim().length > 0;

  return (
    <Show when={placeholderLayout()}>
      {(layout) => (
        <div
          data-event-placeholder
          class="absolute flex items-center px-1.5 text-xs truncate"
          style={{
            left: "0",
            transform: `translateX(${layout().left}px)`,
            width: `${layout().width}px`,
            top: `${props.row * ALL_DAY_ROW_HEIGHT + 4}px`,
            height: "var(--grid-all-day-chip-height)",
            "background-color": hasTitle()
              ? `color-mix(in srgb, ${getDraftColor()} 18%, var(--color-surface))`
              : `color-mix(in srgb, ${getDraftColor()} 10%, var(--color-surface))`,
            "border-radius": CHIP_BORDER_RADIUS,
            "z-index": "50",
          }}
        >
          <Show when={hasTitle()}>
            <span class="truncate">{draftTitle()}</span>
          </Show>
        </div>
      )}
    </Show>
  );
}
