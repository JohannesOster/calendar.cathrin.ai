import { Show } from "solid-js";
import { Eye, EyeOff } from "lucide-solid";
import { defaultCalendarId, setDefaultCalendar, type Calendar } from "../../../stores/accounts";
import { SIDEBAR } from "../../../constants/sidebar";

interface CalendarItemProps {
  calendar: Calendar;
  accountId: string;
  onToggleVisibility: (accountId: string, calendarId: string, currentVisible: boolean) => void;
}

export function CalendarItem(props: CalendarItemProps) {
  const isDefault = () => defaultCalendarId() === props.calendar.id;

  return (
    <div class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#efefef] group">
      {/* Color indicator - clickable to set as default */}
      <button
        onClick={() => setDefaultCalendar(props.calendar.id)}
        class="w-3 h-3 rounded flex-shrink-0 cursor-pointer transition-transform hover:scale-110"
        style={{
          "background-color": props.calendar.color,
          "box-shadow": isDefault()
            ? `0 0 0 2px white, 0 0 0 4px ${props.calendar.color}`
            : undefined,
        }}
        title="Set as default calendar"
      />

      {/* Calendar name */}
      <span
        class="flex-1 text-sm truncate"
        classList={{
          "text-[#37352f]": props.calendar.visible,
          "text-[#91918e] line-through": !props.calendar.visible,
        }}
      >
        {props.calendar.name}
      </span>

      {/* Default badge */}
      <Show when={isDefault()}>
        <span class="text-xs text-[#91918e]">Default</span>
      </Show>

      {/* Visibility toggle */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          props.onToggleVisibility(
            props.accountId,
            props.calendar.id,
            props.calendar.visible
          );
        }}
        class="p-1 rounded hover:bg-[#d8d8d8] text-[#91918e] opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {props.calendar.visible ? (
          <Eye size={SIDEBAR.ICON_MD} />
        ) : (
          <EyeOff size={SIDEBAR.ICON_MD} />
        )}
      </button>
    </div>
  );
}
