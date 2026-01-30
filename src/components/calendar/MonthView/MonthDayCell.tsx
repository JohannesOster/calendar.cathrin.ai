import { isToday } from "../../../lib/date-utils";

export interface DayInfo {
  day: number;
  date: Date;
  isCurrentMonth: boolean;
}

interface MonthDayCellProps {
  dayInfo: DayInfo;
  isFlashing?: boolean;
}

export function MonthDayCell(props: MonthDayCellProps) {
  const isTodayDate = () => isToday(props.dayInfo.date);
  // Show the 1st of month in a distinctive way
  const isFirstOfMonth = () => props.dayInfo.day === 1;

  return (
    <div
      class="border-r border-b border-[#e8e8e8] p-1 min-h-0 transition-colors duration-200"
      classList={{
        "bg-[#e8f4fd]": props.isFlashing,
      }}
    >
      {/* Day number - top right */}
      <div class="flex justify-end">
        <span
          class="w-7 h-7 flex items-center justify-center text-sm rounded-full"
          classList={{
            "bg-[#2383e2] text-white": isTodayDate(),
            "text-[#37352f] font-medium": isFirstOfMonth() && !isTodayDate(),
            "text-[#37352f]": !isFirstOfMonth() && !isTodayDate(),
          }}
        >
          {props.dayInfo.day}
        </span>
      </div>

      {/* Event area - reserved for future issues */}
      <div class="flex-1" />
    </div>
  );
}
