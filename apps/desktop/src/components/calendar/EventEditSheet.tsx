import { Show, onMount, createEffect, on, createSignal } from "solid-js";
import { Popover } from "@ark-ui/solid/popover";
import {
  isEditSheetOpen,
  editSheetEventId,
  editSheetAnchorEl,
  creationSheetOpen,
  closeEditSheet,
} from "../../stores/event-popover";
import { HEADER_HEIGHT } from "../../constants/calendar";
import { centerDate } from "../../stores/calendar-navigation";
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

function useEditDismiss() {
  return () => {
    if (creationSheetOpen()) {
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
      deselectEvent();
    }
    closeEditSheet();
  };
}

export function EventEditSheet() {
  const handleDismiss = useEditDismiss();

  // Close creation sheet when creation ends externally (e.g., grid Escape handler)
  createEffect(on(isCreating, (creating) => {
    if (!creating && creationSheetOpen()) {
      closeEditSheet();
    }
  }, { defer: true }));

  const isOpen = () => isEditSheetOpen();
  const hasContent = () => (editSheetEventId() && selectedEvent()) || creationSheetOpen();

  // Hide positioner for 1 frame on open so Floating UI can compute position
  // before anything is visible (prevents stale --x/--y flicker).
  const [positioned, setPositioned] = createSignal(false);

  createEffect(on(isEditSheetOpen, (open) => {
    if (open) {
      setPositioned(false);
      requestAnimationFrame(() => setPositioned(true));
    }
  }));

  // Snapshot the anchor rect when the sheet opens so the popover stays
  // vertically stable even when the event placeholder moves (date change).
  const [frozenRect, setFrozenRect] = createSignal<DOMRect | null>(null);

  createEffect(on(isEditSheetOpen, (open) => {
    if (open) {
      const el = editSheetAnchorEl();
      if (el) setFrozenRect(el.getBoundingClientRect());
    } else {
      setFrozenRect(null);
    }
  }));

  // After a date change triggers a grid scroll (centerDate changes),
  // update the frozen rect to the anchor's new position once scroll settles.
  createEffect(on(centerDate, () => {
    if (!isEditSheetOpen()) return;
    setTimeout(() => {
      const el = editSheetAnchorEl();
      if (el) setFrozenRect(el.getBoundingClientRect());
    }, 150);
  }, { defer: true }));

  // Virtual anchor: frozen Y position, live X from current anchor element.
  // Clamped so the popover never overlaps the day header row.
  const getVirtualAnchor = () => {
    const liveEl = editSheetAnchorEl();
    const rect = frozenRect();
    if (!rect) return liveEl;

    // Use live X so popover follows horizontal column changes,
    // but keep the frozen Y for vertical stability.
    const liveRect = liveEl?.getBoundingClientRect();
    const x = liveRect ? liveRect.x : rect.x;
    const width = liveRect ? liveRect.width : rect.width;

    // Safe area: popover top must not go above the day header bottom.
    // Header row top is roughly at the grid container top; use a fixed
    // minimum based on the header height + some padding for the app title bar.
    const minTop = HEADER_HEIGHT + 80; // header row + app chrome
    const y = Math.max(rect.y, minTop);

    return {
      getBoundingClientRect: () => ({
        x,
        y,
        width,
        height: rect.height,
        top: y,
        left: x,
        right: x + width,
        bottom: y + rect.height,
      }),
    };
  };

  return (
    <Popover.Root
      open={isOpen()}
      onOpenChange={(details) => {
        if (!details.open) handleDismiss();
      }}
      positioning={{
        placement: "right-start",
        flip: true,
        slide: true,
        overlap: true,
        offset: { mainAxis: 8 },
        overflowPadding: 12,
        getAnchorElement: getVirtualAnchor,
      }}
      portalled
      autoFocus={false}
      modal={false}
      closeOnInteractOutside
      onInteractOutside={(e) => {
        // Let clicks on event chips pass through — selectEvent handles the transition
        const target = e.detail.originalEvent.target as HTMLElement;
        if (target.closest("[data-event-id]")) {
          e.preventDefault();
        }
      }}
      closeOnEscape
    >
      <Popover.Positioner style={{ "z-index": "99", visibility: positioned() ? "visible" : "hidden" }}>
        <Popover.Content
          class="w-80 bg-surface-elevated border border-border rounded-xl shadow-lg overflow-hidden outline-none flex flex-col"
          style={{ "max-height": "calc(100vh - 24px)", animation: positioned() ? "popover-grow 80ms ease-out" : "none" }}
          aria-label={creationSheetOpen() ? "Create event" : "Edit event"}
        >
          <Show when={hasContent()}>
            <SheetFormContent />
          </Show>
        </Popover.Content>
      </Popover.Positioner>
    </Popover.Root>
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
