import { Show } from "solid-js";
import { Dialog } from "@ark-ui/solid/dialog";
import { Portal } from "solid-js/web";
import {
  pendingDeleteConfirmEvent,
  confirmDeleteWithChoice,
  cancelDeleteConfirm,
} from "../../stores/event-deletion";
import { getProviderForCalendar } from "../../stores/accounts";

export function DeleteConfirmDialog() {
  const isOpen = () => pendingDeleteConfirmEvent() !== null;

  return (
    <Dialog.Root
      open={isOpen()}
      onOpenChange={(details) => {
        if (!details.open) cancelDeleteConfirm();
      }}
      closeOnInteractOutside
      closeOnEscape
    >
      <Portal>
        <Dialog.Backdrop class="fixed inset-0 bg-black/40 z-50 animate-fade-in" />
        <Dialog.Positioner class="fixed inset-0 flex items-center justify-center z-50">
          <Dialog.Content class="bg-surface rounded-xl shadow-xl border border-border w-80 p-4 animate-scale-in">
            <Show when={pendingDeleteConfirmEvent()}>
              {(event) => {
                const othersCount = () => event().attendees!.filter(a => !a.isSelf).length;
                const isOutlook = () => getProviderForCalendar(event().calendarId) === "outlook";
                return (
                <>
                  <Dialog.Title class="text-sm font-medium text-fg mb-1">
                    Delete "{event().title}"?
                  </Dialog.Title>
                  <Dialog.Description class="text-sm text-fg-muted mb-4">
                    This event has {othersCount()} other participant{othersCount() > 1 ? "s" : ""}.
                  </Dialog.Description>
                  <div class="flex flex-col gap-2">
                    <button
                      class="w-full text-sm py-2 px-3 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors cursor-pointer border-none outline-none font-medium"
                      onClick={() => confirmDeleteWithChoice("all")}
                    >
                      {othersCount() === 1 ? "Send cancellation" : `Send ${othersCount()} cancellations`}
                    </button>
                    <Show when={!isOutlook()}>
                      <button
                        class="w-full text-sm py-2 px-3 rounded-lg bg-surface-hover text-fg hover:bg-border transition-colors cursor-pointer border-none outline-none"
                        onClick={() => confirmDeleteWithChoice("none")}
                      >
                        Delete without notifying
                      </button>
                    </Show>
                    <Show when={isOutlook()}>
                      <p class="text-xs text-fg-muted text-center px-2">
                        Outlook automatically notifies attendees of cancellations.
                      </p>
                    </Show>
                    <button
                      class="w-full text-sm py-2 px-3 rounded-lg text-fg-muted hover:text-fg transition-colors cursor-pointer border-none outline-none bg-transparent"
                      onClick={() => cancelDeleteConfirm()}
                    >
                      Cancel
                    </button>
                  </div>
                </>
                );
              }}
            </Show>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
