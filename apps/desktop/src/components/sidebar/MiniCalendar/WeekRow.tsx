import { createMemo, For, Show } from "solid-js";
import { isToday } from "../../../lib/date-utils";

export interface DayInfo {
  day: number;
  date: Date;
  isCurrentMonth: boolean;
}

interface WeekRowProps {
  week: DayInfo[];
  visibleRange: () => { start: number; end: number };
  onDayClick: (dayInfo: DayInfo) => void;
}

export function WeekRow(props: WeekRowProps) {
  // Memoize visible indices computation for this row
  const visibleIndices = createMemo(() => {
    const range = props.visibleRange();
    const indices: number[] = [];
    props.week.forEach((dayInfo, idx) => {
      const checkDate = new Date(dayInfo.date);
      checkDate.setHours(12, 0, 0, 0);
      const dateTime = checkDate.getTime();
      if (dateTime >= range.start && dateTime <= range.end) {
        indices.push(idx);
      }
    });
    return indices;
  });

  // Memoize background style for visible range highlight
  const backgroundStyle = createMemo(() => {
    const indices = visibleIndices();
    if (indices.length === 0) return null;

    const firstIdx = Math.min(...indices);
    const lastIdx = Math.max(...indices);
    return {
      left: `${(firstIdx / 7) * 100}%`,
      width: `${((lastIdx - firstIdx + 1) / 7) * 100}%`,
    };
  });

  return (
    <div class="relative py-1">
      {/* Continuous background for visible days in this row */}
      <Show when={backgroundStyle()}>
        {(style) => (
          <div
            class="absolute top-0 bottom-0 bg-[#f1f1ef] rounded-md"
            style={style()}
          />
        )}
      </Show>

      <div class="relative grid grid-cols-7">
        <For each={props.week}>
          {(dayInfo) => {
            const checkDate = new Date(dayInfo.date);
            checkDate.setHours(12, 0, 0, 0);
            const dateTime = checkDate.getTime();
            const isTodayDate = isToday(dayInfo.date);

            // Create reactive getter that accesses the visibleRange memo
            const isVisible = () => {
              const range = props.visibleRange();
              return dateTime >= range.start && dateTime <= range.end;
            };

            return (
              <button
                class="w-7 h-6 flex items-center justify-center text-xs transition-colors rounded"
                classList={{
                  "text-[#37352f]": dayInfo.isCurrentMonth && !isTodayDate,
                  "text-[#c4c4c4]": !dayInfo.isCurrentMonth && !isVisible(),
                  "text-[#91918e]": !dayInfo.isCurrentMonth && isVisible() && !isTodayDate,
                  "bg-[#2383e2] text-white hover:bg-[#2383e2]": isTodayDate,
                  "hover:bg-[#e3e3e3]": !isTodayDate && !isVisible(),
                  "hover:bg-[#e5e5e3]": !isTodayDate && isVisible(),
                }}
                onClick={() => props.onDayClick(dayInfo)}
              >
                {dayInfo.day}
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}
