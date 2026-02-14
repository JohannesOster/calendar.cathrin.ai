import { createSignal } from "solid-js";
import { Popover } from "@ark-ui/solid/popover";
import { Tooltip } from "@ark-ui/solid/tooltip";
import { ChevronDown, Info } from "lucide-solid";

interface NotificationConfirmPopoverProps {
  addedCount: number;
  removedCount: number;
  onSend: () => Promise<void>;
  onSendSilent: () => void;
  onDiscard: () => Promise<void>;
}

export function NotificationConfirmPopover(props: NotificationConfirmPopoverProps) {
  const [sending, setSending] = createSignal(false);
  const [discarding, setDiscarding] = createSignal(false);

  const hasAdds = () => props.addedCount > 0;
  const hasRemoves = () => props.removedCount > 0;
  const isMixed = () => hasAdds() && hasRemoves();

  const label = () => {
    if (isMixed()) {
      const total = props.addedCount + props.removedCount;
      return `Notify ${total} participants`;
    }
    if (hasRemoves()) {
      return props.removedCount === 1
        ? "Send cancellation"
        : `Send ${props.removedCount} cancellations`;
    }
    return props.addedCount === 1
      ? "Send invite"
      : `Send ${props.addedCount} invites`;
  };

  const discardLabel = () => {
    if (isMixed()) return "Discard changes";
    if (hasRemoves()) return props.removedCount === 1 ? "Undo removal" : "Undo removals";
    return props.addedCount === 1 ? "Discard invite" : "Discard invites";
  };

  const silentLabel = () => {
    if (hasRemoves() && !hasAdds()) return "Remove without emailing";
    if (isMixed()) return "Save without emailing";
    return "Add without emailing";
  };

  async function handleSend(): Promise<void> {
    if (sending() || discarding()) return;
    setSending(true);
    try {
      await props.onSend();
    } finally {
      setSending(false);
    }
  }

  async function handleDiscard(): Promise<void> {
    if (sending() || discarding()) return;
    setDiscarding(true);
    try {
      await props.onDiscard();
    } finally {
      setDiscarding(false);
    }
  }

  return (
    <div class="pl-[30px] pr-2 pt-1">
      <div class="flex items-center">
        {/* Main send button */}
        <button
          class="text-sm py-2 px-3 rounded-l-lg bg-accent text-white hover:bg-accent/90 transition-colors cursor-pointer border-none outline-none font-medium text-left"
          onClick={handleSend}
          disabled={sending() || discarding()}
        >
          {label()}
        </button>
        {/* Separator */}
        <div class="self-stretch flex items-center bg-accent">
          <div class="w-0.5 h-full bg-white/20 rounded-full" />
        </div>
        {/* Chevron dropdown */}
        <Popover.Root positioning={{ placement: "bottom-end" }}>
          <Popover.Trigger
            class="self-stretch flex items-center justify-center px-2 rounded-r-lg bg-accent text-white hover:bg-accent/90 transition-colors cursor-pointer border-none outline-none"
            aria-label="More invitation options"
            disabled={sending() || discarding()}
          >
            <ChevronDown size={14} />
          </Popover.Trigger>
          <Popover.Positioner>
            <Popover.Content
              class="bg-surface border border-border rounded-lg shadow-lg z-50 w-72 py-2"
              aria-label="Invitation notification options"
            >
              {/* Discard invitations */}
              <Popover.CloseTrigger
                class="w-full text-left text-sm text-red-500 hover:bg-surface-hover px-3 py-2 transition-colors cursor-pointer border-none outline-none bg-transparent"
                onClick={handleDiscard}
                disabled={sending() || discarding()}
              >
                {discardLabel()}
              </Popover.CloseTrigger>

              {/* Send without email */}
              <div class="flex items-center px-3 py-2 hover:bg-surface-hover transition-colors">
                <Popover.CloseTrigger
                  class="flex-1 text-left text-sm text-fg cursor-pointer border-none outline-none bg-transparent p-0"
                  onClick={() => props.onSendSilent()}
                  disabled={sending() || discarding()}
                >
                  {silentLabel()}
                </Popover.CloseTrigger>
                <Tooltip.Root openDelay={200} positioning={{ placement: "top" }}>
                  <Tooltip.Trigger
                    class="text-fg-disabled hover:text-fg-muted transition-colors cursor-help bg-transparent border-none outline-none p-0.5"
                    aria-label="What does this mean?"
                  >
                    <Info size={14} />
                  </Tooltip.Trigger>
                  <Tooltip.Positioner>
                    <Tooltip.Content class="bg-fg text-surface text-xs rounded px-2 py-1 max-w-52 z-50">
                      Attendees will see the event on their next calendar sync. No email is sent.
                    </Tooltip.Content>
                  </Tooltip.Positioner>
                </Tooltip.Root>
              </div>
            </Popover.Content>
          </Popover.Positioner>
        </Popover.Root>
      </div>
    </div>
  );
}
