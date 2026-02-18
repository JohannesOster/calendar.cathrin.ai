import { Show, onMount, createEffect, on } from "solid-js";
import { Dialog } from "@ark-ui/solid/dialog";
import { Portal } from "solid-js/web";
import {
  isEditSheetOpen,
  editSheetEventId,
  creationSheetOpen,
  closeEditSheet,
} from "../../stores/event-popover";
import { selectedEvent, deselectEvent } from "../../stores/event-selection";
import {
  isCreating,
  draftTitle,
  commitCreation,
  cancelCreation,
  draftHasAttendees,
  showCommitPrompt,
  setShowCommitPrompt,
} from "../../stores/event-creation";
import { useEventFormState } from "../sidebar/useEventFormState";
import {
  TimeSection,
  DetailsSection,
  DescriptionSection,
  CalendarSection,
  RemindersSection,
} from "../sidebar/EventFormSections";
import { RecurrenceScopeDialog } from "../ui/RecurrenceScopeDialog";

export function EventEditSheet() {
  const handleDismiss = () => {
    if (creationSheetOpen()) {
      // Creation mode: commit or cancel based on title
      if (draftHasAttendees()) {
        setShowCommitPrompt(true);
        return;
      }
      if (draftTitle().trim()) {
        commitCreation();
      } else {
        cancelCreation();
      }
    } else {
      // Edit mode: deselect triggers auto-save via useEventFormState
      deselectEvent();
    }
    closeEditSheet();
  };

  // Close creation sheet when creation ends externally (e.g., grid Escape handler)
  createEffect(on(isCreating, (creating) => {
    if (!creating && creationSheetOpen()) {
      closeEditSheet();
    }
  }, { defer: true }));

  const isOpen = () => isEditSheetOpen();
  const hasContent = () => (editSheetEventId() && selectedEvent()) || creationSheetOpen();

  return (
    <Dialog.Root
      open={isOpen()}
      onOpenChange={(details) => {
        if (!details.open) {
          handleDismiss();
        }
      }}
      closeOnInteractOutside
      closeOnEscape
      trapFocus
    >
      <Portal>
        <Dialog.Backdrop class="fixed inset-0 bg-black/20 z-40 animate-fade-in" />
        <Dialog.Positioner class="fixed inset-0 flex items-center justify-center z-40">
          <Dialog.Content
            class="bg-surface-elevated rounded-xl shadow-xl border border-border w-[480px] max-h-[80vh] animate-scale-in outline-none overflow-hidden flex flex-col"
            aria-label={creationSheetOpen() ? "Create event" : "Edit event"}
          >
            <Show when={hasContent()}>
              <SheetFormContent />
            </Show>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

function SheetFormContent() {
  let titleInputRef: HTMLInputElement | undefined;
  const state = useEventFormState();

  onMount(() => {
    requestAnimationFrame(() => {
      titleInputRef?.focus();
    });
  });

  const handleTitleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (state.mode() === "create") {
        if (draftTitle().trim()) {
          if (draftHasAttendees()) {
            setShowCommitPrompt(true);
          } else {
            commitCreation();
            closeEditSheet();
          }
        }
      } else {
        (e.target as HTMLInputElement).blur();
      }
    }
  };

  return (
    <>
      <RecurrenceScopeDialog
        open={!!state.pendingScopePatch()}
        mode="edit"
        hideThisEvent={state.pendingScopePatch()?.isRecurrenceChange}
        hasAttendees={!!(selectedEvent()?.attendees?.length)}
        onSelect={(scope) => state.confirmEditScope(scope)}
        onCancel={() => state.cancelEditScope()}
      />
      <Show when={state.pendingNotifyPatch()}>
        <EditNotifyPrompt
          onNotify={() => state.confirmNotify("all")}
          onSilent={() => state.confirmNotify("none")}
          onCancel={() => state.cancelNotify()}
        />
      </Show>
      <Show when={showCommitPrompt()}>
        <CommitPrompt />
      </Show>
      <div
        class="flex-1 overflow-y-auto scrollbar-hidden"
        classList={{ "opacity-50 pointer-events-none select-none": showCommitPrompt() || !!state.pendingNotifyPatch() }}
      >
        {/* Title input */}
        <div class="px-4 pt-4 pb-2">
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
    </>
  );
}

function EditNotifyPrompt(props: {
  onNotify: () => void;
  onSilent: () => void;
  onCancel: () => void;
}) {
  return (
    <div class="mx-4 mt-4 mb-1 border border-border rounded-lg bg-surface overflow-hidden">
      <p class="text-xs text-fg-muted px-3 py-2 border-b border-border">
        This change affects attendees
      </p>
      <button
        ref={(el) => requestAnimationFrame(() => el.focus())}
        class="w-full text-left text-sm text-accent hover:bg-surface-hover px-3 py-2 transition-colors cursor-pointer border-none outline-none bg-transparent font-medium"
        onClick={() => props.onNotify()}
      >
        Notify attendees
      </button>
      <button
        class="w-full text-left text-sm text-fg hover:bg-surface-hover px-3 py-2 transition-colors cursor-pointer border-none outline-none bg-transparent"
        onClick={() => props.onSilent()}
      >
        Save without emailing
      </button>
      <button
        class="w-full text-left text-sm text-fg-muted hover:bg-surface-hover px-3 py-2 transition-colors cursor-pointer border-none outline-none bg-transparent"
        onClick={() => props.onCancel()}
      >
        Undo change
      </button>
    </div>
  );
}

function CommitPrompt() {
  const hasTitle = () => !!draftTitle().trim();

  return (
    <div class="mx-4 mt-4 mb-1 border border-border rounded-lg bg-surface overflow-hidden">
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
        onClick={() => { cancelCreation(); closeEditSheet(); }}
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
        onClick={() => { if (hasTitle()) { commitCreation("all"); closeEditSheet(); } }}
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
        onClick={() => { if (hasTitle()) { commitCreation("none"); closeEditSheet(); } }}
      >
        Add without emailing
      </button>
    </div>
  );
}
