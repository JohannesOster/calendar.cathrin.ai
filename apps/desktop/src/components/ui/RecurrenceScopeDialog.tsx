import { createSignal, createEffect, on, Show } from "solid-js";
import { Dialog } from "@ark-ui/solid/dialog";
import { Portal } from "solid-js/web";

export type RecurrenceScope = "single" | "all" | "following";

interface RecurrenceScopeDialogProps {
  open: boolean;
  mode: "edit" | "delete";
  /** Hide "This event" option (e.g. for recurrence rule changes where single makes no sense). */
  hideThisEvent?: boolean;
  onSelect: (scope: RecurrenceScope) => void;
  onCancel: () => void;
}

export function RecurrenceScopeDialog(props: RecurrenceScopeDialogProps) {
  const defaultScope = () => props.hideThisEvent ? "following" : "single";
  const [scope, setScope] = createSignal<RecurrenceScope>(defaultScope());

  // Reset selection when dialog opens or hideThisEvent changes
  createEffect(on(() => props.open, (open) => {
    if (open) setScope(defaultScope());
  }));

  const title = () => props.mode === "delete" ? "Delete recurring event" : "Edit recurring event";
  const actionLabel = () => props.mode === "delete" ? "Delete" : "Continue";

  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(details) => {
        if (!details.open) props.onCancel();
      }}
      closeOnInteractOutside
      closeOnEscape
    >
      <Portal>
        <Dialog.Backdrop class="fixed inset-0 bg-black/40 z-50 animate-fade-in" />
        <Dialog.Positioner class="fixed inset-0 flex items-center justify-center z-50">
          <Dialog.Content class="bg-surface rounded-xl shadow-xl border border-border w-80 p-4 animate-scale-in">
            <Dialog.Title class="text-sm font-medium text-fg mb-3">
              {title()}
            </Dialog.Title>

            <div class="space-y-2 mb-4" role="radiogroup" aria-label="Scope">
              <Show when={!props.hideThisEvent}>
                <label class="flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded hover:bg-surface-hover transition-colors">
                  <input
                    type="radio"
                    name="recurrence-scope"
                    value="single"
                    checked={scope() === "single"}
                    onChange={() => setScope("single")}
                    class="accent-fg"
                  />
                  <span class="text-sm text-fg">This event</span>
                </label>
              </Show>
              <label class="flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded hover:bg-surface-hover transition-colors">
                <input
                  type="radio"
                  name="recurrence-scope"
                  value="following"
                  checked={scope() === "following"}
                  onChange={() => setScope("following")}
                  class="accent-fg"
                />
                <span class="text-sm text-fg">This and following events</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded hover:bg-surface-hover transition-colors">
                <input
                  type="radio"
                  name="recurrence-scope"
                  value="all"
                  checked={scope() === "all"}
                  onChange={() => setScope("all")}
                  class="accent-fg"
                />
                <span class="text-sm text-fg">All events</span>
              </label>
            </div>

            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="text-sm py-1.5 px-3 rounded-lg text-fg-muted hover:text-fg transition-colors cursor-pointer border-none outline-none bg-transparent"
                onClick={() => props.onCancel()}
              >
                Cancel
              </button>
              <button
                type="button"
                class={`text-sm py-1.5 px-3 rounded-lg transition-colors cursor-pointer border-none outline-none font-medium ${
                  props.mode === "delete"
                    ? "bg-red-600 text-white hover:bg-red-700"
                    : "bg-fg text-bg hover:opacity-90"
                }`}
                onClick={() => props.onSelect(scope())}
              >
                {actionLabel()}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
