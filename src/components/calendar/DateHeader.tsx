interface DateHeaderProps {
  date: Date;
  isToday?: boolean;
}

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function DateHeader(props: DateHeaderProps) {
  const dayName = () => dayNames[props.date.getDay()];
  const dayNumber = () => props.date.getDate();

  const isToday = () => {
    const today = new Date();
    return (
      props.date.getDate() === today.getDate() &&
      props.date.getMonth() === today.getMonth() &&
      props.date.getFullYear() === today.getFullYear()
    );
  };

  const isWeekend = () => {
    const day = props.date.getDay();
    return day === 0 || day === 6;
  };

  return (
    <div
      class="h-full flex flex-col items-center justify-center py-2"
      classList={{
        "bg-[#fafafa]": isWeekend(),
      }}
    >
      {/* Day name */}
      <span
        class="text-xs uppercase tracking-wide"
        classList={{
          "text-[#2383e2]": isToday(),
          "text-[#91918e]": !isToday(),
        }}
      >
        {dayName()}
      </span>

      {/* Day number */}
      <span
        class="text-xl font-medium mt-0.5 w-8 h-8 flex items-center justify-center rounded-full"
        classList={{
          "bg-[#2383e2] text-white": isToday(),
          "text-[#37352f]": !isToday(),
        }}
      >
        {dayNumber()}
      </span>
    </div>
  );
}
