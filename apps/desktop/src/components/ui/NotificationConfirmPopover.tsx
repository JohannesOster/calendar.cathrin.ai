import { createSignal } from "solid-js";
import { Popover } from "@ark-ui/solid/popover";
import { Tooltip } from "@ark-ui/solid/tooltip";
import { ChevronDown, Info, Mail } from "lucide-solid";

interface NotificationConfirmPopoverProps {
  count: number;
  onSend: () => Promise<void>;
  onSendSilent: () => void;
  onDiscard: () => Promise<void>;
}

export function NotificationConfirmPopover(props: NotificationConfirmPopoverProps) {
  const [sending, setSending] = createSignal(false);
  const [discarding, setDiscarding] = createSignal(false);

  const label = () =>
    props.count === 1
      ? "Send invitation"
      : `Send ${props.count} invitations`;

  const silentLabel = () =>
    props.count === 1
      ? "Send invitation without email"
      : `Send ${props.count} invitations without email`;

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
    <Popover.Root positioning={{ placement: "bottom-start" }}>
      <Popover.Trigger
        class="flex items-center gap-2 w-full text-sm text-accent px-2 py-2 rounded hover:bg-surface-hover transition-colors cursor-pointer border-none outline-none bg-transparent"
        aria-label="Invitations not sent — choose notification option"
      >
        <Mail size={14} class="shrink-0" />
        <span>Invitations not sent</span>
      </Popover.Trigger>
      <Popover.Positioner>
        <Popover.Content
          class="bg-surface border border-border rounded-lg shadow-lg z-50 w-64 py-2"
          aria-label="Invitation notification options"
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSend();
            }
          }}
        >
          {/* Discard changes */}
          <button
            class="w-full text-left text-sm text-red-500 hover:bg-surface-hover px-3 py-2 transition-colors cursor-pointer border-none outline-none bg-transparent"
            onClick={handleDiscard}
            disabled={sending() || discarding()}
          >
            Discard changes
          </button>

          {/* Send without email */}
          <div class="flex items-center px-3 py-2 hover:bg-surface-hover transition-colors">
            <Popover.CloseTrigger
              class="flex-1 text-left text-sm text-fg-muted cursor-pointer border-none outline-none bg-transparent p-0"
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

          {/* Primary: Send invitation */}
          <div class="px-3 pt-1 pb-1">
            <button
              class="w-full text-sm py-2 px-3 rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors cursor-pointer border-none outline-none font-medium flex items-center justify-center gap-1"
              onClick={handleSend}
              disabled={sending() || discarding()}
            >
              <span>{label()}</span>
              <ChevronDown size={14} class="opacity-50" />
            </button>
          </div>
        </Popover.Content>
      </Popover.Positioner>
    </Popover.Root>
  );
}
