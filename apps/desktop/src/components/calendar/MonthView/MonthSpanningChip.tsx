import type { CalendarEvent } from "../../../stores/events";

interface MonthSpanningChipProps {
  event: CalendarEvent;
  startCol: number;
  span: number;
  row: number;
  startsBeforeView: boolean;
  endsAfterView: boolean;
  dayNumberHeight: number;
  chipHeight: number;
  chipGap: number;
}

export function MonthSpanningChip(props: MonthSpanningChipProps) {
  const getBorderRadius = () => {
    const left = props.startsBeforeView ? "0" : "4px";
    const right = props.endsAfterView ? "0" : "4px";
    return `${left} ${right} ${right} ${left}`;
  };

  return (
    <div
      class="all-day-chip absolute flex items-center px-1.5 text-xs cursor-pointer truncate transition-[background-color]"
      style={{
        left: `calc(${(props.startCol / 7) * 100}% + 2px)`,
        width: `calc(${(props.span / 7) * 100}% - 4px)`,
        top: `${props.dayNumberHeight + props.row * (props.chipHeight + props.chipGap)}px`,
        height: `${props.chipHeight}px`,
        "--event-color": props.event.color,
        "border-radius": getBorderRadius(),
      }}
      tabIndex={0}
      role="button"
      aria-label={props.event.title}
    >
      <div
        class="all-day-chip__ribbon absolute left-0 top-0 bottom-0 w-[3px]"
        style={{
          "background-color": props.event.color,
          "border-radius": `${props.startsBeforeView ? "0" : "4px"} 0 0 ${props.startsBeforeView ? "0" : "4px"}`,
        }}
      />
      <span class="truncate text-[#37352f] ml-0.5">{props.event.title}</span>
    </div>
  );
}
