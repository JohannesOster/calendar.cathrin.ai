import { createSignal, onCleanup, For } from "solid-js";
import { X, Info } from "lucide-solid";
import {
  onDeletion,
  undoDelete,
  confirmDelete,
  onMove,
  undoMove,
  confirmMove,
} from "../../stores/events";

const AUTO_DISMISS_MS = 5000;
const EXIT_DURATION_MS = 150;

interface ToastEntry {
  eventId: string;
  title: string;
  type: "delete" | "move";
}

function UndoToastItem(props: {
  entry: ToastEntry;
  onRemove: () => void;
}) {
  const [isVisible, setIsVisible] = createSignal(false);
  const [isExiting, setIsExiting] = createSignal(false);
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;
  let dismissed = false;

  requestAnimationFrame(() => setIsVisible(true));

  const dismiss = () => {
    if (dismissed) return;
    if (isExiting()) return;
    dismissed = true;
    if (dismissTimer) clearTimeout(dismissTimer);
    setIsExiting(true);
    setTimeout(() => {
      if (props.entry.type === "move") {
        confirmMove(props.entry.eventId);
      } else {
        confirmDelete(props.entry.eventId);
      }
      props.onRemove();
    }, EXIT_DURATION_MS);
  };

  const handleUndo = () => {
    dismissed = true;
    if (dismissTimer) clearTimeout(dismissTimer);
    if (props.entry.type === "move") {
      undoMove(props.entry.eventId);
    } else {
      undoDelete(props.entry.eventId);
    }
    props.onRemove();
  };

  dismissTimer = setTimeout(dismiss, AUTO_DISMISS_MS);

  onCleanup(() => {
    if (dismissTimer) clearTimeout(dismissTimer);
  });

  return (
    <div
      role="alert"
      class="transition-[opacity,transform] ease-out"
      style={{
        "transition-duration": isExiting() ? `${EXIT_DURATION_MS}ms` : "200ms",
        opacity: isExiting() ? 0 : isVisible() ? 1 : 0,
        transform: isExiting()
          ? "translateY(8px)"
          : isVisible()
            ? "translateY(0)"
            : "translateY(8px)",
      }}
    >
      <div class="bg-fg text-white rounded-xl shadow-lg px-4 py-3 min-w-[280px] max-w-[400px]">
        <div class="flex items-start gap-2">
          <Info size={16} class="text-white/60 shrink-0 mt-0.5" />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium">
              {props.entry.type === "move" ? "Event moved" : "Event deleted"}
            </div>
            <div class="text-xs text-white/60 mt-0.5 truncate">
              "{props.entry.title}"
            </div>
          </div>
          <button
            onClick={dismiss}
            class="text-white/40 hover:text-white transition-colors shrink-0 -mt-0.5"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
        <div class="flex justify-end mt-2">
          <button
            onClick={handleUndo}
            class="px-3 py-1 text-xs font-medium text-white bg-white/10 hover:bg-white/20 rounded transition-colors"
          >
            Undo
          </button>
        </div>
      </div>
    </div>
  );
}

export function UndoToast() {
  const [toasts, setToasts] = createSignal<ToastEntry[]>([]);

  const unsubDelete = onDeletion((deletion) => {
    const entry: ToastEntry = {
      eventId: deletion.event.id,
      title: deletion.event.title,
      type: "delete",
    };
    setToasts((prev) => [...prev, entry]);
  });

  const unsubMove = onMove((move) => {
    // Replace existing move toast for the same event (rapid re-drags)
    setToasts((prev) => prev.filter((t) => !(t.eventId === move.eventId && t.type === "move")));
    const entry: ToastEntry = {
      eventId: move.eventId,
      title: move.title,
      type: "move",
    };
    setToasts((prev) => [...prev, entry]);
  });

  onCleanup(() => {
    unsubDelete();
    unsubMove();
  });

  const removeToast = (eventId: string) => {
    setToasts((prev) => prev.filter((t) => t.eventId !== eventId));
  };

  return (
    <div class="absolute bottom-4 left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2 items-center">
      <For each={toasts()}>
        {(entry) => (
          <UndoToastItem
            entry={entry}
            onRemove={() => removeToast(entry.eventId)}
          />
        )}
      </For>
    </div>
  );
}
