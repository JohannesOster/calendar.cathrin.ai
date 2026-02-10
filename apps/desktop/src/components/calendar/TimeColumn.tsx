import { For } from "solid-js";

const hours = Array.from({ length: 24 }, (_, i) => i);

function formatHour(hour: number): string {
  if (hour === 0) return "";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

export function TimeColumn() {
  return (
    <div class="flex flex-col">
      <For each={hours}>
        {(hour) => (
          <div
            class="h-[var(--grid-hour-height)] flex items-start justify-end pr-2"
            style={{ height: "var(--grid-hour-height)" }}
          >
            {/* Time label - use negative margin to center on grid line */}
            <span class="text-2xs text-fg-muted leading-none -mt-[0.35rem]">
              {formatHour(hour)}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}
