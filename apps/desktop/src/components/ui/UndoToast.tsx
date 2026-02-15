import { onCleanup, Show } from "solid-js";
import { X, Info, CircleAlert } from "lucide-solid";
import {
  Toaster,
  Toast,
} from "@ark-ui/solid/toast";
import {
  onDeletion,
  undoDelete,
  confirmDelete,
} from "../../stores/event-deletion";
import { toaster } from "../../lib/toast";

const undoneIds = new Set<string>();

export function UndoToastProvider() {
  const unsubDelete = onDeletion((deletion) => {
    const eventId = deletion.event.id;

    toaster.create({
      id: eventId,
      title: "Event deleted",
      description: deletion.event.title,
      type: "info",
      meta: { eventId },
      action: {
        label: "Undo",
        onClick() {
          undoneIds.add(eventId);
          undoDelete(eventId);
        },
      },
      onStatusChange(details) {
        if (details.status === "unmounted") {
          if (undoneIds.has(eventId)) {
            undoneIds.delete(eventId);
          } else {
            confirmDelete(eventId);
          }
        }
      },
    });
  });

  onCleanup(() => unsubDelete());

  return (
    <Toaster
      toaster={toaster}
      class="!absolute !bottom-4 !left-1/2 !-translate-x-1/2 !z-[200] flex flex-col gap-2 items-center"
    >
      {(toast) => (
        <Toast.Root
          class="bg-surface-active border border-border text-fg rounded-lg px-4 py-3 min-w-[280px] max-w-[400px] animate-toast-enter data-[state=closed]:animate-toast-exit"
        >
          <div class="flex items-start gap-2">
            <Show
              when={toast().type === "error"}
              fallback={<Info size={16} class="text-fg-muted shrink-0 mt-0.5" />}
            >
              <CircleAlert size={16} class="text-red-400 shrink-0 mt-0.5" />
            </Show>
            <div class="flex-1 min-w-0">
              <Toast.Title class="text-sm font-medium">
                {toast().title}
              </Toast.Title>
              <Show when={toast().description}>
                <Toast.Description class="text-xs text-fg-muted mt-0.5 truncate">
                  {toast().type === "error" ? toast().description : `"${toast().description}"`}
                </Toast.Description>
              </Show>
            </div>
            <Toast.CloseTrigger
              class="text-fg-faint hover:text-fg transition-colors shrink-0 -mt-0.5"
              aria-label="Dismiss"
            >
              <X size={14} />
            </Toast.CloseTrigger>
          </div>
          <Show when={toast().action}>
            <div class="flex justify-end mt-2">
              <Toast.ActionTrigger
                class="px-3 py-1 text-xs font-medium text-fg bg-surface-hover hover:bg-border rounded transition-colors"
              >
                Undo
              </Toast.ActionTrigger>
            </div>
          </Show>
        </Toast.Root>
      )}
    </Toaster>
  );
}
