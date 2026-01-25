import { Show } from "solid-js";
import { createSortable, useDragDropContext } from "@thisbeyond/solid-dnd";
import { Eye, EyeOff } from "lucide-solid";
import {
  defaultCalendarId,
  setDefaultCalendar,
  type Calendar,
} from "../../../stores/accounts";
import { SIDEBAR } from "../../../constants/sidebar";

// Shared calendar item content used in both sortable items and drag overlay
interface CalendarItemContentProps {
  calendar: Calendar;
  isDefault: boolean;
  onSetDefault?: () => void;
  onToggleVisibility?: () => void;
  class?: string;
}

export function CalendarItemContent(props: CalendarItemContentProps) {
  return (
    <div
      class={`flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--color-bg-hover)] group cursor-grab select-none ${props.class ?? ""}`}
    >
      {/* Color indicator - clickable to set as default */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          props.onSetDefault?.();
        }}
        class="w-3 h-3 rounded shrink-0 cursor-pointer transition-transform hover:scale-110"
        style={{
          "background-color": props.calendar.color,
          "box-shadow": props.isDefault
            ? `0 0 0 2px white, 0 0 0 4px ${props.calendar.color}`
            : undefined,
        }}
        title="Set as default calendar"
      />

      {/* Calendar name */}
      <span
        class="flex-1 text-sm truncate"
        classList={{
          "text-[var(--color-text-primary)]": props.calendar.visible,
          "text-[var(--color-text-secondary)] line-through": !props.calendar.visible,
        }}
      >
        {props.calendar.name}
      </span>

      {/* Default badge */}
      <Show when={props.isDefault}>
        <span class="text-xs text-[var(--color-text-secondary)]">Default</span>
      </Show>

      {/* Visibility toggle */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          props.onToggleVisibility?.();
        }}
        class="p-1 rounded hover:bg-[var(--color-bg-button-hover)] text-[var(--color-text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity"
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

interface SortableCalendarItemProps {
  calendar: Calendar;
  accountId: string;
  onToggleVisibility: (
    accountId: string,
    calendarId: string,
    currentVisible: boolean
  ) => void;
}

export function SortableCalendarItem(props: SortableCalendarItemProps) {
  // Tag as "calendar" type for collision filtering
  const sortable = createSortable(props.calendar.id, { type: "calendar" });
  const [state] = useDragDropContext()!;
  const isDefault = () => defaultCalendarId() === props.calendar.id;

  return (
    <div
      // @ts-ignore - use: directive
      use:sortable
      class="rounded"
      classList={{
        "transition-transform": !!state.active.draggable,
      }}
    >
      {/* Placeholder shown when this item is being dragged */}
      <Show when={sortable.isActiveDraggable}>
        <div class="px-2 py-1.5">
          <div class="h-6 rounded bg-[var(--color-border)]" />
        </div>
      </Show>
      <Show when={!sortable.isActiveDraggable}>
        <CalendarItemContent
          calendar={props.calendar}
          isDefault={isDefault()}
          onSetDefault={() => setDefaultCalendar(props.calendar.id)}
          onToggleVisibility={() =>
            props.onToggleVisibility(
              props.accountId,
              props.calendar.id,
              props.calendar.visible
            )
          }
        />
      </Show>
    </div>
  );
}
