import { onMount, onCleanup } from "solid-js";
import {
  isCreating,
  draftTitle,
  commitCreation,
  cancelCreation,
} from "../../stores/event-creation";
import { useEventFormState } from "./useEventFormState";
import {
  TimeSection,
  DetailsSection,
  DescriptionSection,
  CalendarSection,
  RemindersSection,
} from "./EventFormSections";

export function EventForm() {
  let titleInputRef: HTMLInputElement | undefined;
  let formRef: HTMLDivElement | undefined;

  const state = useEventFormState();

  // Auto-focus title input in create mode only
  onMount(() => {
    if (state.mode() === "create") {
      // Small delay to ensure DOM is ready after sidebar content switch
      requestAnimationFrame(() => {
        titleInputRef?.focus();
      });
    }
  });

  // Click-outside detection (create mode only)
  onMount(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!isCreating()) return;

      const target = e.target as HTMLElement;

      // Don't handle if click is inside the form
      if (formRef?.contains(target)) return;

      // Don't handle if click is on the event placeholder
      if (target.closest("[data-event-placeholder]")) return;

      // Don't handle if click is inside a DayColumn (starting a new drag)
      // The DayColumn mousedown handler will handle saving + new creation
      if (target.closest("[data-day-column]")) return;

      if (draftTitle().trim()) {
        commitCreation();
      } else {
        cancelCreation();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    onCleanup(() => document.removeEventListener("mousedown", handleClickOutside));
  });

  const handleTitleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && state.mode() === "create") {
      e.preventDefault();
      if (draftTitle().trim()) {
        commitCreation();
      }
    }
    // Escape is handled by CalendarGrid's document-level handler
  };

  return (
    <div ref={formRef} class="h-full flex flex-col overflow-hidden" data-event-form>
      <div class="flex-1 overflow-y-auto scrollbar-hidden">
        {/* Title input */}
        <div class="px-3 pt-3 pb-2">
          <input
            ref={titleInputRef}
            type="text"
            placeholder="Title"
            value={state.title()}
            onInput={(e) => state.setTitle(e.currentTarget.value)}
            onBlur={() => { if (state.mode() === "edit") state.flushSave(); }}
            onKeyDown={handleTitleKeyDown}
            class="w-full text-sm font-medium text-fg placeholder-fg-disabled bg-surface-input outline-none border-none rounded-md px-2 py-1.5 hover:bg-surface-hover focus:bg-surface-hover transition-colors"
          />
        </div>

        <TimeSection state={state} />
        <DetailsSection state={state} />
        <DescriptionSection state={state} />
        <CalendarSection state={state} />
        <RemindersSection state={state} />
      </div>
    </div>
  );
}
