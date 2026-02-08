import { createSignal, createEffect, onCleanup, Show } from "solid-js";
import { X, Info } from "lucide-solid";
import {
  lastDeletedEvent,
  undoDelete,
  clearLastDeleted,
} from "../../stores/events";

const AUTO_DISMISS_MS = 5000;

export function UndoToast() {
  const [isExiting, setIsExiting] = createSignal(false);
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;

  const dismiss = () => {
    setIsExiting(true);
    setTimeout(() => {
      clearLastDeleted();
      setIsExiting(false);
    }, 150); // Match exit animation duration
  };

  const handleUndo = () => {
    if (dismissTimer) clearTimeout(dismissTimer);
    undoDelete();
    setIsExiting(false);
  };

  // Auto-dismiss timer, restarted when a new deletion occurs
  createEffect(() => {
    const deleted = lastDeletedEvent();
    if (!deleted) {
      setIsExiting(false);
      return;
    }

    // Reset exit state for new toast
    setIsExiting(false);

    if (dismissTimer) clearTimeout(dismissTimer);
    dismissTimer = setTimeout(dismiss, AUTO_DISMISS_MS);
  });

  onCleanup(() => {
    if (dismissTimer) clearTimeout(dismissTimer);
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      dismiss();
    }
  };

  return (
    <Show when={lastDeletedEvent()}>
      {(deleted) => (
        <div
          class={`absolute bottom-4 left-1/2 -translate-x-1/2 z-[200] ${isExiting() ? "animate-toast-exit" : "animate-toast-enter"}`}
          role="alert"
          onKeyDown={handleKeyDown}
        >
          <div class="bg-[#37352f] text-white rounded-xl shadow-lg px-4 py-3 min-w-[280px] max-w-[400px]">
            <div class="flex items-start gap-2">
              <Info size={16} class="text-[#ffffff99] shrink-0 mt-0.5" />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium">Event deleted</div>
                <div class="text-xs text-[#ffffff99] mt-0.5 truncate">
                  "{deleted().event.title}"
                </div>
              </div>
              <button
                onClick={dismiss}
                class="text-[#ffffff66] hover:text-white transition-colors shrink-0 -mt-0.5"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
            <div class="flex justify-end mt-2">
              <button
                onClick={handleUndo}
                class="px-3 py-1 text-xs font-medium text-white bg-[#ffffff1a] hover:bg-[#ffffff33] rounded transition-colors"
              >
                Undo
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
