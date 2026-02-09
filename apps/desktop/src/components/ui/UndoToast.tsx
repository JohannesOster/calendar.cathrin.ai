import { onCleanup } from "solid-js";
import { X, Info } from "lucide-solid";
import {
  createToaster,
  Toaster,
  Toast,
} from "@ark-ui/solid/toast";
import {
  onDeletion,
  undoDelete,
  confirmDelete,
} from "../../stores/events";

const AUTO_DISMISS_MS = 5000;
const EXIT_DURATION_MS = 150;

const undoneIds = new Set<string>();

export const toaster = createToaster({
  placement: "bottom",
  duration: AUTO_DISMISS_MS,
  removeDelay: EXIT_DURATION_MS,
  max: 5,
  overlap: false,
  offsets: "1rem",
});

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
          class="bg-surface-active border border-border-light text-fg rounded-xl shadow-lg px-4 py-3 min-w-[280px] max-w-[400px] animate-toast-enter data-[state=closed]:animate-toast-exit"
        >
          <div class="flex items-start gap-2">
            <Info size={16} class="text-fg-muted shrink-0 mt-0.5" />
            <div class="flex-1 min-w-0">
              <Toast.Title class="text-sm font-medium">
                {toast().title}
              </Toast.Title>
              <Toast.Description class="text-xs text-fg-muted mt-0.5 truncate">
                "{toast().description}"
              </Toast.Description>
            </div>
            <Toast.CloseTrigger
              class="text-fg-faint hover:text-fg transition-colors shrink-0 -mt-0.5"
              aria-label="Dismiss"
            >
              <X size={14} />
            </Toast.CloseTrigger>
          </div>
          <div class="flex justify-end mt-2">
            <Toast.ActionTrigger
              class="px-3 py-1 text-xs font-medium text-fg bg-surface-hover hover:bg-border rounded transition-colors"
            >
              Undo
            </Toast.ActionTrigger>
          </div>
        </Toast.Root>
      )}
    </Toaster>
  );
}
