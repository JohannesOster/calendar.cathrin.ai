import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { Minus, Plus } from "lucide-solid";
import { visibleDaysCount, setVisibleDaysCount } from "../../stores/view";

const MIN_DAYS = 1;
const MAX_DAYS = 14;

export function DaysStepperButton() {
  const [isOpen, setIsOpen] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;

  // Click outside detection
  onMount(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef && !containerRef.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    onCleanup(() => document.removeEventListener("mousedown", handleClickOutside));
  });

  const decrement = () => {
    setVisibleDaysCount(visibleDaysCount() - 1);
  };

  const increment = () => {
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
    <div
      ref={containerRef}
      class="relative flex items-center gap-1"
    >
      {/* Count badge - shown when not a preset (1 = Day, 7 = Week).
           Uses CSS display toggle instead of <Show> to keep the visibleDaysCount
           subscription alive. Toggling <Show> at the 1↔2 boundary disposes/creates
           subscriptions in the same reactive cycle as the popover text node update,
           which prevents the popover counter from re-rendering. */}
      <button
        onClick={() => setIsOpen(!isOpen())}
        class="h-5 min-w-[1.25rem] px-1 flex items-center justify-center rounded text-fg bg-surface-hover hover:bg-border transition-colors text-xs font-medium"
        style={{ display: showCountBadge() ? "flex" : "none" }}
        aria-label={`${visibleDaysCount()} days visible`}
      >
        {visibleDaysCount()}
      </button>

      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen())}
        class="w-5 h-5 flex items-center justify-center rounded text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors text-xs font-medium"
        aria-label="Adjust visible days"
      >
        ±
      </button>

      {/* Popover */}
      <Show when={isOpen()}>
        <div
          class="absolute top-full right-0 mt-1 flex items-center gap-1 bg-fg rounded-full px-1.5 py-0.5 shadow-lg transition-opacity z-30"
          style={{ opacity: isOpen() ? 1 : 0 }}
        >
          {/* Decrement button */}
          <button
            onClick={decrement}
            disabled={isAtMin()}
            class="w-5 h-5 flex items-center justify-center rounded-full transition-colors"
            classList={{
              "text-white/40 cursor-not-allowed": isAtMin(),
              "text-white hover:bg-white/10": !isAtMin(),
            }}
            aria-label="Show fewer days"
          >
            <Minus size={12} />
          </button>

          {/* Current count */}
          <span
            class="text-white text-xs font-medium min-w-[1.25rem] text-center select-none cursor-default"
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
              "text-white/40 cursor-not-allowed": isAtMax(),
              "text-white hover:bg-white/10": !isAtMax(),
            }}
            aria-label="Show more days"
          >
            <Plus size={12} />
          </button>
        </div>
      </Show>
    </div>
  );
}
