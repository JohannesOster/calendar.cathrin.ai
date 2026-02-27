import { Show } from "solid-js";
import { createSortable, useDragDropContext } from "@thisbeyond/solid-dnd";
import { ChevronDown, ChevronUp, Ellipsis, TriangleAlert, Loader2 } from "lucide-solid";
import { Menu } from "@ark-ui/solid/menu";
import type { CalendarAccount } from "../../../stores/accounts";
import { SIDEBAR } from "../../../constants/sidebar";
import googleIcon from "../../../assets/google.svg";
import outlookIcon from "../../../assets/outlook.svg";

interface AccountItemProps {
  account: CalendarAccount;
  isCollapsed: boolean;
  isReconnecting?: boolean;
  toggleCollapse: () => void;
  onReconnect?: () => void;
}

export function SortableAccountItem(props: AccountItemProps) {
  // Tag as "account" type for collision filtering
  const sortable = createSortable(props.account.id, { type: "account" });
  const [state] = useDragDropContext()!;

  const isDisconnected = () => props.account.syncStatus === "auth_error";

  return (
    <div
      // @ts-ignore - use: directive
      use:sortable
      class="rounded"
      classList={{
        "transition-transform": !!state.active.draggable,
      }}
    >
      <Show when={sortable.isActiveDraggable}>
        <div class="px-2 py-1">
          <div class="h-7 rounded bg-[var(--color-border)]" />
        </div>
      </Show>
      <Show when={!sortable.isActiveDraggable}>
        <div
          class="group px-2 py-1 rounded cursor-pointer hover:bg-surface-hover select-none"
          onClick={() => {
            if (!isDisconnected()) {
              props.toggleCollapse();
            }
          }}
        >
          <div class="flex items-center gap-1">
            <Show
              when={!isDisconnected()}
              fallback={
                <TriangleAlert
                  size={13}
                  class="shrink-0 mr-1 text-amber-500"
                  aria-label="Account disconnected"
                />
              }
            >
              <img
                src={props.account.provider === "outlook" ? outlookIcon : googleIcon}
                alt={props.account.provider}
                width="13"
                height="13"
                class="shrink-0 mr-1"
              />
            </Show>
            <span class="text-xs font-medium text-fg-muted truncate flex-1 min-w-0">
              {props.account.email}
            </span>
            <Show when={!isDisconnected()}>
              <span class="text-fg-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                {props.isCollapsed ? (
                  <ChevronUp size={SIDEBAR.ICON_MD} />
                ) : (
                  <ChevronDown size={SIDEBAR.ICON_MD} />
                )}
              </span>
            </Show>
            <Menu.Root positioning={{ placement: "bottom-end" }}>
              <Menu.Trigger
                onClick={(e: MouseEvent) => e.stopPropagation()}
                class="p-1 rounded hover:bg-surface-hover text-fg-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-pointer"
              >
                <Ellipsis size={SIDEBAR.ICON_MD} />
              </Menu.Trigger>
              <Menu.Positioner>
                <Menu.Content class="z-50 min-w-[160px] rounded-md border border-border bg-surface p-1 shadow-md">
                  <Menu.Item value="refresh" class="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-fg cursor-pointer hover:bg-surface-hover outline-none data-[highlighted]:bg-surface-hover">
                    Refresh
                  </Menu.Item>
                  <Menu.Separator class="my-1 h-px bg-border" />
                  <Menu.Item value="remove" class="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-red-500 cursor-pointer hover:bg-surface-hover outline-none data-[highlighted]:bg-surface-hover">
                    Remove account
                  </Menu.Item>
                </Menu.Content>
              </Menu.Positioner>
            </Menu.Root>
          </div>
          {/* Disconnected status line */}
          <Show when={isDisconnected()}>
            <div class="flex items-center gap-1 ml-[18px] mt-0.5">
              <Show
                when={!props.isReconnecting}
                fallback={
                  <span class="text-[11px] text-fg-faint flex items-center gap-1">
                    <Loader2 size={10} class="animate-spin" />
                    Reconnecting…
                  </span>
                }
              >
                <span class="text-[11px] text-fg-faint">
                  Disconnected ·{" "}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onReconnect?.();
                    }}
                    class="text-fg-muted hover:text-fg underline cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded"
                  >
                    Reconnect
                  </button>
                </span>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
