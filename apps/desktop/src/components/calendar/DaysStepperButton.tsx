import { Popover, usePopoverContext } from "@ark-ui/solid/popover";
import { Minus, Plus } from "lucide-solid";
import { visibleDaysCount, setVisibleDaysCount } from "../../stores/view";
import {
  visibleStartDate,
  setNavigationTarget,
} from "../../stores/calendar-navigation";

const MIN_DAYS = 1;
const MAX_DAYS = 14;

export function DaysStepperButton() {
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
    <Popover.Root
      positioning={{ placement: "bottom-end" }}
      portalled={false}
      autoFocus={false}
    >
      <div class="relative flex items-center gap-1">
        {/* Count badge - shown when not a preset (1 = Day, 7 = Week).
             Uses CSS display toggle instead of <Show> to keep the visibleDaysCount
             subscription alive. Toggling <Show> at the 1↔2 boundary disposes/creates
             subscriptions in the same reactive cycle as the popover text node update,
             which prevents the popover counter from re-rendering. */}
        <CountBadge showCountBadge={showCountBadge} />

        {/* Trigger button */}
        <Popover.Trigger
          class="w-5 h-5 flex items-center justify-center rounded text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors text-xs font-medium"
          aria-label="Adjust visible days"
        >
          ±
        </Popover.Trigger>

        {/* Popover */}
        <Popover.Positioner>
          <Popover.Content
            class="flex items-center gap-1 bg-surface-active border border-border-light rounded-full px-1.5 py-0.5 shadow-lg z-30"
          >
            {/* Decrement button */}
            <button
              onClick={decrement}
              disabled={isAtMin()}
              class="w-5 h-5 flex items-center justify-center rounded-full transition-colors"
              classList={{
                "text-fg-disabled cursor-not-allowed": isAtMin(),
                "text-fg hover:bg-surface-hover": !isAtMin(),
              }}
              aria-label="Show fewer days"
            >
              <Minus size={12} />
            </button>

            {/* Current count */}
            <span
              class="text-fg text-xs font-medium min-w-[1.25rem] text-center select-none cursor-default"
              aria-live="polite"
            >
              {visibleDaysCount()}
            </span>

            {/* Increment button */}
            <button
              onClick={increment}
              disabled={isAtMax()}
              class="w-5 h-5 flex items-center justify-center rounded-full transition-colors"
              classList={{
                "text-fg-disabled cursor-not-allowed": isAtMax(),
                "text-fg hover:bg-surface-hover": !isAtMax(),
              }}
              aria-label="Show more days"
            >
              <Plus size={12} />
            </button>
          </Popover.Content>
        </Popover.Positioner>
      </div>
    </Popover.Root>
  );
}

function CountBadge(props: { showCountBadge: () => boolean }) {
  const popover = usePopoverContext();
  return (
    <button
      onClick={() => popover().setOpen(!popover().open)}
      class="h-5 min-w-[1.25rem] px-1 flex items-center justify-center rounded text-fg bg-surface-hover hover:bg-border transition-colors text-xs font-medium"
      style={{ display: props.showCountBadge() ? "flex" : "none" }}
      aria-label={`${visibleDaysCount()} days visible`}
    >
      {visibleDaysCount()}
    </button>
  );
}
