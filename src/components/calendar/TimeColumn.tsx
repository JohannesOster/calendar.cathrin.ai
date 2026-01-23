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
    <div class="relative">
      <For each={hours}>
        {(hour) => (
          <div
            class="h-[var(--grid-hour-height)] relative"
            style={{ height: "var(--grid-hour-height)" }}
          >
            {/* Time label - positioned to align with grid line */}
            <span class="absolute -top-2.5 right-2 text-xs text-[#91918e] bg-white px-1">
              {formatHour(hour)}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}
