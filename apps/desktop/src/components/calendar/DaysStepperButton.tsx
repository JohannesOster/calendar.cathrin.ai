import { createSignal, Show, onMount, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { Minus, Plus } from "lucide-solid";
import { visibleDaysCount, setVisibleDaysCount } from "../../stores/view";
import {
  visibleStartDate,
  setNavigationTarget,
} from "../../stores/calendar-navigation";

const MIN_DAYS = 1;
const MAX_DAYS = 14;

export function DaysStepperButton() {
  const [isOpen, setIsOpen] = createSignal(false);
  let triggerRef: HTMLButtonElement | undefined;
  let badgeRef: HTMLButtonElement | undefined;

  const toggle = () => setIsOpen(!isOpen());

  const decrement = () => {
    setNavigationTarget(visibleStartDate());
    setVisibleDaysCount(visibleDaysCount() - 1);
  };

  const increment = () => {
    setNavigationTarget(visibleStartDate());
    setVisibleDaysCount(visibleDaysCount() + 1);
  };

  const isAtMin = () => visibleDaysCount() <= MIN_DAYS;
  const isAtMax = () => visibleDaysCount() >= MAX_DAYS;

  // Show count badge when not a preset (1 = Day, 7 = Week)
  const showCountBadge = () => {
    const count = visibleDaysCount();
    return count !== 1 && count !== 7;
  };

  return (
    <div class="relative flex items-center">
      {/* Count badge - absolutely positioned so the ± trigger stays fixed.
           Uses CSS display toggle instead of <Show> to keep the visibleDaysCount
           subscription alive. Toggling <Show> at the 1↔2 boundary disposes/creates
           subscriptions in the same reactive cycle as the popover text node update,
           which prevents the popover counter from re-rendering. */}
      <button
        ref={badgeRef}
        onClick={toggle}
        class="absolute h-5 min-w-[1.25rem] px-1 flex items-center justify-center rounded text-fg bg-surface-hover hover:bg-border transition-colors text-xs font-medium"
        style={{
          right: "calc(100% + 4px)",
          display: showCountBadge() ? "flex" : "none",
        }}
        aria-label={`${visibleDaysCount()} days visible`}
      >
        {visibleDaysCount()}
      </button>

      {/* Trigger button */}
      <button
        ref={triggerRef}
        onClick={toggle}
        class="w-5 h-5 flex items-center justify-center rounded text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors text-xs font-medium"
        aria-label="Adjust visible days"
        aria-expanded={isOpen()}
      >
        ±
      </button>

      {/* Popover content — SolidJS Portal to escape contain/overflow context */}
      <Show when={isOpen()}>
        <StepperPopover
          getTriggerRef={() => triggerRef}
          getBadgeRef={() => badgeRef}
          decrement={decrement}
          increment={increment}
          isAtMin={isAtMin}
          isAtMax={isAtMax}
          onClose={() => setIsOpen(false)}
        />
      </Show>
    </div>
  );
}

function StepperPopover(props: {
  getTriggerRef: () => HTMLButtonElement | undefined;
  getBadgeRef: () => HTMLButtonElement | undefined;
  decrement: () => void;
  increment: () => void;
  isAtMin: () => boolean;
  isAtMax: () => boolean;
  onClose: () => void;
}) {
  let ref: HTMLDivElement | undefined;

  onMount(() => {
    const trigger = props.getTriggerRef();
    if (trigger && ref) {
      const rect = trigger.getBoundingClientRect();
      ref.style.top = `${rect.bottom + 4}px`;
      ref.style.right = `${window.innerWidth - rect.right}px`;
    }

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const trigger = props.getTriggerRef();
      const badge = props.getBadgeRef();
      if (
        ref &&
        !ref.contains(target) &&
        !trigger?.contains(target) &&
        !badge?.contains(target)
      ) {
        props.onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    onCleanup(() => document.removeEventListener("mousedown", handleClickOutside));
  });

  return (
    <Portal>
      <div
        ref={ref}
        class="flex items-center gap-1 bg-surface-hover border border-border-light rounded-sm px-1.5 py-0.5 shadow-md"
        style={{
          position: "fixed",
          "z-index": "9999",
        }}
      >
        <button
          onClick={props.decrement}
          disabled={props.isAtMin()}
          class="w-5 h-5 flex items-center justify-center rounded-full transition-colors"
          classList={{
            "text-fg-disabled cursor-not-allowed": props.isAtMin(),
            "text-fg hover:bg-surface-hover": !props.isAtMin(),
          }}
          aria-label="Show fewer days"
        >
          <Minus size={12} />
        </button>

        <span
          class="text-fg text-xs font-medium min-w-[1.25rem] text-center select-none cursor-default"
          aria-live="polite"
        >
          {visibleDaysCount()}
        </span>

        <button
          onClick={props.increment}
          disabled={props.isAtMax()}
          class="w-5 h-5 flex items-center justify-center rounded-full transition-colors"
          classList={{
            "text-fg-disabled cursor-not-allowed": props.isAtMax(),
            "text-fg hover:bg-surface-hover": !props.isAtMax(),
          }}
          aria-label="Show more days"
        >
          <Plus size={12} />
        </button>
      </div>
    </Portal>
  );
}
