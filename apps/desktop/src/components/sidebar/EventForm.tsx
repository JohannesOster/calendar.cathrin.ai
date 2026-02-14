import { Show, onMount, onCleanup } from "solid-js";
import {
  isCreating,
  draftTitle,
  commitCreation,
  cancelCreation,
  draftHasAttendees,
  showCommitPrompt,
  setShowCommitPrompt,
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

      // When attendees are present, always show commit prompt instead of direct commit/cancel
      if (draftHasAttendees()) {
        setShowCommitPrompt(true);
        return;
      }

      if (draftTitle().trim()) {
        commitCreation();
      } else {
        cancelCreation();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    onCleanup(() => document.removeEventListener("mousedown", handleClickOutside));
  });

  // Escape while commit prompt is showing: cancel creation immediately
  onMount(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showCommitPrompt()) {
        cancelCreation();
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", handleEscape);
    onCleanup(() => document.removeEventListener("keydown", handleEscape));
  });

  const handleTitleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && state.mode() === "create") {
      e.preventDefault();
      if (draftTitle().trim()) {
        if (draftHasAttendees()) {
          setShowCommitPrompt(true);
        } else {
          commitCreation();
        }
      }
    }
    // Escape is handled by CalendarGrid's document-level handler
  };

  return (
    <div ref={formRef} class="h-full flex flex-col overflow-hidden" data-event-form>
      <Show when={showCommitPrompt()}>
        <CommitPrompt />
      </Show>
      <div
        class="flex-1 overflow-y-auto scrollbar-hidden"
        classList={{ "opacity-50 pointer-events-none select-none": showCommitPrompt() }}
      >
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
            disabled={state.mode() === "edit" && !state.isOrganizer()}
            class={`w-full text-sm font-medium text-fg placeholder-fg-disabled outline-none border-none rounded-md px-2 py-1.5 transition-colors ${
              state.mode() === "edit" && !state.isOrganizer()
                ? "bg-transparent cursor-default"
                : "bg-surface-input hover:bg-surface-hover focus:bg-surface-hover"
            }`}
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

function CommitPrompt() {
  const hasTitle = () => !!draftTitle().trim();

  return (
    <div class="mx-3 mt-3 mb-1 border border-border rounded-lg bg-surface overflow-hidden">
      <p class="text-xs text-fg-muted px-3 py-2 border-b border-border">
        This event has attendees
      </p>
      <button
        ref={(el) => requestAnimationFrame(() => el.focus())}
        class="w-full text-left text-sm text-fg-muted hover:bg-surface-hover px-3 py-2 transition-colors cursor-pointer border-none outline-none bg-transparent"
        onClick={() => setShowCommitPrompt(false)}
      >
        Continue editing
      </button>
      <button
        class="w-full text-left text-sm text-red-500 hover:bg-surface-hover px-3 py-2 transition-colors cursor-pointer border-none outline-none bg-transparent"
        onClick={() => cancelCreation()}
      >
        Discard event
      </button>
      <button
        class="w-full text-left text-sm px-3 py-2 transition-colors border-none outline-none bg-transparent"
        disabled={!hasTitle()}
        classList={{
          "text-accent hover:bg-surface-hover cursor-pointer font-medium": hasTitle(),
          "text-fg-disabled cursor-default": !hasTitle(),
        }}
        onClick={() => { if (hasTitle()) commitCreation("all"); }}
      >
        Send invite
      </button>
      <button
        class="w-full text-left text-sm px-3 py-2 transition-colors border-none outline-none bg-transparent"
        disabled={!hasTitle()}
        classList={{
          "text-fg hover:bg-surface-hover cursor-pointer": hasTitle(),
          "text-fg-disabled cursor-default": !hasTitle(),
        }}
        onClick={() => { if (hasTitle()) commitCreation("none"); }}
      >
        Add without emailing
      </button>
    </div>
  );
}
