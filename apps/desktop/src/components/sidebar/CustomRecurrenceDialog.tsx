import { createSignal, createMemo, Show, For } from "solid-js";
import { Dialog } from "@ark-ui/solid/dialog";
import { Portal } from "solid-js/web";
import {
  type Frequency,
  type DayCode,
  type EndCondition,
  type RecurrenceConfig,
  DAY_CODES,
  dayCodeFromDate,
  buildRrule,
  formatRecurrence,
} from "../../utils/recurrence-format";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const FREQ_OPTIONS: { value: Frequency; label: string }[] = [
  { value: "DAILY", label: "day" },
  { value: "WEEKLY", label: "week" },
  { value: "MONTHLY", label: "month" },
  { value: "YEARLY", label: "year" },
];

interface CustomRecurrenceDialogProps {
  open: boolean;
  onClose: () => void;
  onDone: (rrule: string[]) => void;
  eventStart: Date;
}

export function CustomRecurrenceDialog(props: CustomRecurrenceDialogProps) {
  const [freq, setFreq] = createSignal<Frequency>("WEEKLY");
  const [interval, setInterval] = createSignal(1);
  const [byDay, setByDay] = createSignal<DayCode[]>([dayCodeFromDate(props.eventStart)]);
  const [endCondition, setEndCondition] = createSignal<EndCondition>({ type: "never" });
  const [endDate, setEndDate] = createSignal("");
  const [endCount, setEndCount] = createSignal(10);

  // Reset when opened with a new event start
  const resetToDefaults = () => {
    setFreq("WEEKLY");
    setInterval(1);
    setByDay([dayCodeFromDate(props.eventStart)]);
    setEndCondition({ type: "never" });
    setEndDate("");
    setEndCount(10);
  };

  const config = createMemo((): RecurrenceConfig => {
    let end: EndCondition = { type: "never" };
    const ec = endCondition();
    if (ec.type === "date" && endDate()) {
      end = { type: "date", date: new Date(endDate()) };
    } else if (ec.type === "count") {
      end = { type: "count", count: endCount() };
    }
    return {
      freq: freq(),
      interval: interval(),
      byDay: freq() === "WEEKLY" ? byDay() : undefined,
      end,
    };
  });

  const preview = createMemo(() => {
    const rrule = buildRrule(config(), props.eventStart);
    return formatRecurrence(rrule, props.eventStart);
  });

  const isValid = createMemo(() => {
    if (interval() < 1) return false;
    if (freq() === "WEEKLY" && byDay().length === 0) return false;
    if (endCondition().type === "date" && !endDate()) return false;
    if (endCondition().type === "date" && endDate()) {
      const d = new Date(endDate());
      if (d <= props.eventStart) return false;
    }
    if (endCondition().type === "count" && endCount() < 1) return false;
    return true;
  });

  const toggleDay = (day: DayCode) => {
    setByDay(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  const handleDone = () => {
    if (!isValid()) return;
    const rrule = buildRrule(config(), props.eventStart);
    props.onDone(rrule);
  };

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(details) => {
        if (!details.open) props.onClose();
        else resetToDefaults();
      }}
      closeOnInteractOutside
      closeOnEscape
    >
      <Portal>
        <Dialog.Backdrop class="fixed inset-0 bg-black/40 z-50 animate-fade-in" />
        <Dialog.Positioner class="fixed inset-0 flex items-center justify-center z-50">
          <Dialog.Content class="bg-surface rounded-xl shadow-xl border border-border w-80 p-4 animate-scale-in">
            <Dialog.Title class="text-sm font-medium text-fg mb-4">
              Custom recurrence
            </Dialog.Title>

            {/* Interval + Frequency */}
            <div class="flex items-center gap-2 mb-4">
              <span class="text-sm text-fg-muted">Repeat every</span>
              <input
                type="number"
                min={1}
                value={interval()}
                onInput={(e) => setInterval(Math.max(1, parseInt(e.currentTarget.value) || 1))}
                class="w-14 text-sm text-fg bg-surface-input border border-border rounded px-2 py-1 outline-none focus:border-fg"
                aria-label="Repeat interval"
              />
              <select
                value={freq()}
                onChange={(e) => setFreq(e.currentTarget.value as Frequency)}
                class="text-sm text-fg bg-surface-input border border-border rounded px-2 py-1 outline-none focus:border-fg cursor-pointer"
                aria-label="Repeat frequency"
              >
                <For each={FREQ_OPTIONS}>
                  {(opt) => (
                    <option value={opt.value}>
                      {interval() > 1 ? `${opt.label}s` : opt.label}
                    </option>
                  )}
                </For>
              </select>
            </div>

            {/* Day of week toggles (weekly only) */}
            <Show when={freq() === "WEEKLY"}>
              <div class="flex gap-1 mb-4" role="group" aria-label="Days of the week">
                <For each={DAY_CODES}>
                  {(day, i) => (
                    <button
                      type="button"
                      class={`w-7 h-7 rounded-full text-xs font-medium transition-colors cursor-pointer border-none outline-none ${
                        byDay().includes(day)
                          ? "bg-fg text-bg"
                          : "bg-surface-hover text-fg-muted hover:text-fg"
                      }`}
                      aria-pressed={byDay().includes(day)}
                      aria-label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i()]}
                      onClick={() => toggleDay(day)}
                    >
                      {DAY_LABELS[i()]}
                    </button>
                  )}
                </For>
              </div>
            </Show>

            {/* End condition */}
            <div class="mb-4 space-y-2">
              <span class="text-sm text-fg-muted">Ends</span>
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="end-condition"
                  checked={endCondition().type === "never"}
                  onChange={() => setEndCondition({ type: "never" })}
                  class="accent-fg"
                />
                <span class="text-sm text-fg">Never</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="end-condition"
                  checked={endCondition().type === "date"}
                  onChange={() => setEndCondition({ type: "date", date: new Date() })}
                  class="accent-fg"
                />
                <span class="text-sm text-fg">On</span>
                <Show when={endCondition().type === "date"}>
                  <input
                    type="date"
                    value={endDate()}
                    onInput={(e) => setEndDate(e.currentTarget.value)}
                    class="text-sm text-fg bg-surface-input border border-border rounded px-2 py-1 outline-none focus:border-fg"
                    aria-label="End date"
                  />
                </Show>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="end-condition"
                  checked={endCondition().type === "count"}
                  onChange={() => setEndCondition({ type: "count", count: endCount() })}
                  class="accent-fg"
                />
                <span class="text-sm text-fg">After</span>
                <Show when={endCondition().type === "count"}>
                  <input
                    type="number"
                    min={1}
                    value={endCount()}
                    onInput={(e) => setEndCount(Math.max(1, parseInt(e.currentTarget.value) || 1))}
                    class="w-14 text-sm text-fg bg-surface-input border border-border rounded px-2 py-1 outline-none focus:border-fg"
                    aria-label="Number of occurrences"
                  />
                  <span class="text-sm text-fg">occurrences</span>
                </Show>
              </label>
            </div>

            {/* Preview */}
            <div
              class="text-sm text-fg-muted bg-surface-hover rounded px-3 py-2 mb-4"
              aria-live="polite"
            >
              {preview()}
            </div>

            {/* Actions */}
            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="text-sm py-1.5 px-3 rounded-lg text-fg-muted hover:text-fg transition-colors cursor-pointer border-none outline-none bg-transparent"
                onClick={() => props.onClose()}
              >
                Cancel
              </button>
              <button
                type="button"
                class="text-sm py-1.5 px-3 rounded-lg bg-fg text-bg hover:opacity-90 transition-colors cursor-pointer border-none outline-none font-medium disabled:opacity-40 disabled:cursor-default"
                disabled={!isValid()}
                onClick={handleDone}
              >
                Done
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
