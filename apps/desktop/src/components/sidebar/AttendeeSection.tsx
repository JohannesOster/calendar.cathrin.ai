import { Show, For, createSignal, createMemo, createEffect, on, onCleanup } from "solid-js";
import type { Attendee } from "@cathrin/shared-types";
import {
  Users,
  EllipsisVertical,
  Info,
  X,
} from "lucide-solid";
import { sortAttendees, ResponseStatusIcon, STATUS_LABELS } from "./attendee-utils";
import { Combobox, createListCollection } from "@ark-ui/solid/combobox";
import { Popover } from "@ark-ui/solid/popover";
import { Tooltip } from "@ark-ui/solid/tooltip";
import { apiFetch } from "../../lib/api";
import { setDraftAttendees, commitCreation, draftTitle } from "../../stores/event-creation";
import { isPendingNotification, removePendingNotification } from "../../stores/pending-notifications";
import { isBuffered, getOriginalAttendees, clearBuffer } from "../../stores/buffered-attendees";
import { selectedEventId } from "../../stores/event-selection";
import { events, setEvents } from "../../stores/events";
import { NotificationConfirmPopover } from "../ui/NotificationConfirmPopover";
import type { ApiCalendarEvent } from "@cathrin/shared-types";

// =============================================================================
// Attendee list
// =============================================================================

export function AttendeeList(props: {
  attendees: Attendee[] | undefined;
  isOrganizer: boolean;
  accountEmail: string | null;
  mode: "create" | "edit";
  onAdd: (email: string, name?: string) => void;
  onRemove: (email: string) => void;
  onRsvp: (status: "accepted" | "declined" | "tentative", sendUpdates: "all" | "none") => void;
}) {
  const hasAttendees = () => !!props.attendees && props.attendees.length > 0;
  const sorted = createMemo(() => hasAttendees() ? sortAttendees(props.attendees!) : []);
  const selfAttendee = createMemo(() => props.attendees?.find(a => a.isSelf));
  const canRsvp = createMemo(() => {
    if (props.isOrganizer) return false;
    const self = selfAttendee();
    return self && !self.isOrganizer;
  });

  const organizerName = createMemo(() => {
    const organizer = props.attendees?.find(a => a.isOrganizer && !a.isSelf);
    if (!organizer) return "";
    return organizer.name || organizer.email;
  });

  const hasPendingNotification = createMemo(() => {
    const eventId = selectedEventId();
    return eventId ? isPendingNotification(eventId) : false;
  });

  const hasBufferedChanges = createMemo(() => {
    const eventId = selectedEventId();
    return eventId ? isBuffered(eventId) : false;
  });

  const [pendingRemovals, setPendingRemovals] = createSignal<Set<string>>(new Set());
  const [isExpanded, setIsExpanded] = createSignal(false);

  // Reset transient state when switching events
  createEffect(on(() => selectedEventId(), () => {
    setPendingRemovals(new Set<string>());
    setIsExpanded(false);
  }));

  const collapseState = createMemo(() => {
    const all = sorted();
    if (isExpanded()) return { top: all, pinned: null as Attendee | null, hiddenCount: 0 };

    const self = selfAttendee();
    const firstN = all.slice(0, 2);
    const selfInFirstN = self ? firstN.some(a => a.email === self.email) : true;
    const pinned = (!selfInFirstN && self) ? self : null;
    const visibleCount = firstN.length + (pinned ? 1 : 0);
    const hidden = all.length - visibleCount;
    if (hidden < 1) return { top: all, pinned: null as Attendee | null, hiddenCount: 0 };
    return { top: firstN, pinned, hiddenCount: hidden };
  });

  const isPendingRemoval = (email: string) => pendingRemovals().has(email.toLowerCase());

  function togglePendingRemoval(email: string): void {
    setPendingRemovals(prev => {
      const next = new Set(prev);
      const key = email.toLowerCase();
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const showNotificationPopover = createMemo(() => {
    if (props.mode === "create") {
      // Show when there are non-self attendees to notify
      return (props.attendees ?? []).some(a => !a.isSelf);
    }
    // Active work in progress — always show
    if (hasBufferedChanges() || pendingRemovals().size > 0) return true;
    // Pending notification only matters when there are non-self attendees to act on
    if (hasPendingNotification()) {
      return (props.attendees ?? []).some(a => !a.isSelf);
    }
    return false;
  });

  const addedCount = createMemo(() => {
    if (props.mode === "create") {
      // In create mode, all non-self attendees are "new"
      return (props.attendees ?? []).filter(a => !a.isSelf).length;
    }
    const eventId = selectedEventId();
    if (!eventId) return 0;
    const removals = pendingRemovals();
    const current = (props.attendees ?? []).filter(
      a => !a.isSelf && !removals.has(a.email.toLowerCase())
    );
    const original = getOriginalAttendees(eventId);
    if (!original) {
      // Only treat all attendees as new in the creation case
      return isPendingNotification(eventId) ? current.length : 0;
    }
    const originalEmails = new Set(original.map(a => a.email.toLowerCase()));
    return current.filter(a => !originalEmails.has(a.email.toLowerCase())).length;
  });

  const removedCount = createMemo(() => pendingRemovals().size);

  const isCreationPending = createMemo(() => {
    const eventId = selectedEventId();
    if (!eventId) return false;
    return isPendingNotification(eventId) && !isBuffered(eventId);
  });

  async function handleSendInvitations(): Promise<void> {
    const eventId = selectedEventId();
    if (!eventId) return;
    const hasRemovals = pendingRemovals().size > 0;
    // Apply pending removals first
    for (const email of pendingRemovals()) {
      props.onRemove(email);
    }
    setPendingRemovals(new Set<string>());
    // Read attendees from form state (protected by buffer guard against poll overwrites)
    // instead of from events() store which polling can overwrite with stale server data.
    const attendees = props.attendees ?? [];
    const event = events().find(e => e.id === eventId);
    if (!event) return;
    const eventUrl = `/api/events/${encodeURIComponent(event.providerEventId)}?calendarId=${encodeURIComponent(event.calendarId)}`;

    if (isCreationPending() && hasRemovals) {
      // Creation-pending with removals: two-step PATCH to avoid Google
      // sending cancellation emails to never-invited attendees.
      // Step 1: Strip all non-self attendees silently
      const selfOnly = attendees.filter(a => a.isSelf);
      await apiFetch<ApiCalendarEvent>(eventUrl, {
        method: "PATCH",
        body: JSON.stringify({
          attendees: selfOnly.map(a => ({ email: a.email, name: a.name })),
          sendUpdates: "none",
        }),
      });
      // Step 2: Re-add remaining attendees with notifications.
      // If this fails, revert step 1 by restoring all attendees silently.
      const remaining = attendees.filter(a => !a.isSelf);
      if (remaining.length > 0) {
        const allAttendees = [...selfOnly, ...remaining];
        try {
          const response = await apiFetch<ApiCalendarEvent>(eventUrl, {
            method: "PATCH",
            body: JSON.stringify({
              attendees: allAttendees.map(a => ({ email: a.email, name: a.name })),
              sendUpdates: "all",
            }),
          });
          setEvents((prev) => prev.map((e) =>
            e.id === eventId ? { ...e, attendees: response.attendees } : e
          ));
        } catch (err) {
          console.error("[attendees] Step 2 failed, reverting step 1:", err);
          await apiFetch<ApiCalendarEvent>(eventUrl, {
            method: "PATCH",
            body: JSON.stringify({
              attendees: allAttendees.map(a => ({ email: a.email, name: a.name })),
              sendUpdates: "none",
            }),
          }).catch(revertErr => console.error("[attendees] Revert also failed:", revertErr));
          throw err;
        }
      }
    } else {
      // Normal case: PATCH with current attendees + sendUpdates: "all"
      const response = await apiFetch<ApiCalendarEvent>(eventUrl, {
        method: "PATCH",
        body: JSON.stringify({
          attendees: attendees.map(a => ({ email: a.email, name: a.name })),
          sendUpdates: "all",
        }),
      });
      // Update store with server-confirmed attendees so clearBuffer's
      // sync effect reads correct data instead of potentially stale poll data.
      setEvents((prev) => prev.map((e) =>
        e.id === eventId ? { ...e, attendees: response.attendees } : e
      ));
    }
    clearBuffer(eventId);
    removePendingNotification(eventId);
  }

  function handleSendSilent(): void {
    const eventId = selectedEventId();
    if (!eventId) return;
    const hasRemovals = pendingRemovals().size > 0;
    // Apply pending removals first
    for (const email of pendingRemovals()) {
      props.onRemove(email);
    }
    setPendingRemovals(new Set<string>());

    if (isBuffered(eventId) || hasRemovals) {
      // Read attendees from form state (protected by buffer guard) not from store
      const attendees = props.attendees ?? [];
      const event = events().find(e => e.id === eventId);
      if (event) {
        // Re-assert current attendees in store before clearBuffer so the sync
        // effect reads correct data (store may have been overwritten by polling).
        setEvents((prev) => prev.map((e) =>
          e.id === eventId ? { ...e, attendees: attendees.length > 0 ? attendees : undefined } : e
        ));
        apiFetch(`/api/events/${encodeURIComponent(event.providerEventId)}?calendarId=${encodeURIComponent(event.calendarId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            attendees: attendees.map(a => ({ email: a.email, name: a.name })),
            sendUpdates: "none",
          }),
        }).catch(err => console.error("[attendees] Failed to save silently:", err));
      }
      clearBuffer(eventId);
    }
    removePendingNotification(eventId);
  }

  // --- Create-mode handlers ---
  async function handleCreateSend(): Promise<void> {
    commitCreation("all");
  }

  function handleCreateSilent(): void {
    commitCreation("none");
  }

  async function handleCreateDiscard(): Promise<void> {
    setDraftAttendees([]);
  }

  async function handleDiscard(): Promise<void> {
    const eventId = selectedEventId();
    if (!eventId) return;
    const hadPendingRemovals = pendingRemovals().size > 0;
    // Clear pending removals
    setPendingRemovals(new Set<string>());

    if (isBuffered(eventId)) {
      // Edit buffered case: revert to original attendees
      const original = getOriginalAttendees(eventId);
      setEvents((prev) => prev.map(e =>
        e.id === eventId
          ? { ...e, attendees: original && original.length > 0 ? original : undefined }
          : e
      ));
      clearBuffer(eventId);
      return;
    }

    // Creation-pending with only pending removals (no buffer): just undo the removals.
    // The pending notification survives so the popover reverts to "Send invite".
    if (hadPendingRemovals && isPendingNotification(eventId)) return;

    if (!isPendingNotification(eventId)) return;

    // Creation pending case: remove all attendees from server
    const event = events().find(e => e.id === eventId);
    if (!event) return;
    await apiFetch<ApiCalendarEvent>(
      `/api/events/${encodeURIComponent(event.providerEventId)}?calendarId=${encodeURIComponent(event.calendarId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ attendees: null, sendUpdates: "none" }),
      }
    );
    setEvents((prev) => prev.map(e => e.id === eventId ? { ...e, attendees: undefined } : e));
    removePendingNotification(eventId);
  }

  const rsvpSummary = createMemo(() => {
    if (!hasAttendees()) return "";
    const counts: Record<string, number> = { accepted: 0, maybe: 0, declined: 0, pending: 0 };
    for (const a of props.attendees!) {
      if (a.responseStatus === "accepted") counts.accepted++;
      else if (a.responseStatus === "tentative") counts.maybe++;
      else if (a.responseStatus === "declined") counts.declined++;
      else counts.pending++;
    }
    return Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([status, n]) => `${n} ${status}`)
      .join(" \u00b7 ");
  });

  const renderAttendeeRow = (attendee: Attendee) => {
    const pending = () => isPendingRemoval(attendee.email);
    return (
      <div
        class={`group flex items-center gap-2 pl-[30px] pr-2 py-1.5 rounded transition-colors ${
          pending() ? "" : "hover:bg-surface-hover"
        }`}
        role="listitem"
        aria-label={`${attendee.name || attendee.email}, ${STATUS_LABELS[attendee.responseStatus] ?? "No response"}${attendee.isOrganizer ? ", Organizer" : ""}${attendee.isSelf ? ", you" : ""}${pending() ? ", pending removal" : ""}`}
      >
        <span class={pending() ? "opacity-40" : ""}>
          <ResponseStatusIcon status={attendee.responseStatus} />
        </span>
        <span
          class={`flex-1 text-sm truncate ${
            pending() ? "text-fg-disabled line-through" : "text-fg"
          }`}
        >
          {attendee.name || attendee.email}
        </span>
        <Show when={attendee.isSelf || attendee.isOrganizer}>
          <span class={`text-2xs shrink-0 ${pending() ? "text-fg-disabled/50" : "text-fg-disabled"}`}>
            {attendee.isSelf && attendee.isOrganizer
              ? "You · Organizer"
              : attendee.isSelf ? "You" : "Organizer"}
          </span>
        </Show>
        <Show when={props.isOrganizer && !attendee.isSelf}>
          <button
            class={`transition-colors cursor-pointer p-0.5 ${
              pending()
                ? "text-fg-muted hover:text-fg"
                : "text-fg-muted/0 group-hover:text-fg-muted hover:!text-fg"
            }`}
            onClick={() => {
              if (props.mode === "edit") {
                const eventId = selectedEventId();
                const original = eventId ? getOriginalAttendees(eventId) : undefined;
                if (original && !original.some(a => a.email.toLowerCase() === attendee.email.toLowerCase())) {
                  props.onRemove(attendee.email);
                } else {
                  togglePendingRemoval(attendee.email);
                }
              } else {
                props.onRemove(attendee.email);
              }
            }}
            aria-label={pending()
              ? `Undo remove ${attendee.name || attendee.email}`
              : `Remove ${attendee.name || attendee.email}`
            }
          >
            <X size={12} />
          </button>
        </Show>
      </div>
    );
  };

  return (
    <div class="space-y-0.5">
      <Show
        when={hasAttendees()}
        fallback={
          <Show when={props.isOrganizer}>
            <AttendeeCombobox
              attendees={props.attendees}
              accountEmail={props.accountEmail}
              onAdd={props.onAdd}
              inline
            />
          </Show>
        }
      >
        {/* Populated header */}
        <div class="px-2 py-2">
          <div
            class="flex items-center gap-2"
            aria-label={`${props.attendees!.length} participants: ${rsvpSummary()}`}
          >
            <Users size={14} class="text-fg-muted shrink-0" />
            <div class="flex flex-col">
              <span class="text-sm text-fg">
                {props.attendees!.length} participant{props.attendees!.length !== 1 ? "s" : ""}
              </span>
              <Show when={rsvpSummary()}>
                <span class="text-xs text-fg-muted">{rsvpSummary()}</span>
              </Show>
            </div>
          </div>
        </div>
        <For each={collapseState().top}>
          {(attendee) => renderAttendeeRow(attendee)}
        </For>
        <Show when={collapseState().hiddenCount > 0}>
          <button
            class="flex items-center gap-1.5 pl-[30px] pr-2 py-1.5 text-sm text-fg-muted hover:text-fg transition-colors cursor-pointer w-full bg-transparent border-none outline-none"
            onClick={() => setIsExpanded(true)}
          >
            <EllipsisVertical size={12} class="shrink-0" />
            <span>Show {collapseState().hiddenCount} more participants</span>
          </button>
        </Show>
        <Show when={collapseState().pinned}>
          {(self) => renderAttendeeRow(self())}
        </Show>
        <Show when={canRsvp()}>
          <RsvpButtons currentStatus={selfAttendee()!.responseStatus} organizerName={organizerName()} onRsvp={props.onRsvp} />
        </Show>
      </Show>
      <Show when={showNotificationPopover()}>
        <NotificationConfirmPopover
          addedCount={addedCount()}
          removedCount={props.mode === "create" ? 0 : removedCount()}
          isCreationPending={props.mode === "create" || isCreationPending()}
          commitDisabled={props.mode === "create" && !draftTitle().trim()}
          onSend={props.mode === "create" ? handleCreateSend : handleSendInvitations}
          onSendSilent={props.mode === "create" ? handleCreateSilent : handleSendSilent}
          onDiscard={props.mode === "create" ? handleCreateDiscard : handleDiscard}
        />
      </Show>
      <Show when={hasAttendees() && props.isOrganizer}>
        <AttendeeCombobox attendees={props.attendees} accountEmail={props.accountEmail} onAdd={props.onAdd} />
      </Show>
    </div>
  );
}

interface ContactSuggestion {
  email: string;
  name: string | null;
  score: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

function AttendeeCombobox(props: {
  attendees: Attendee[] | undefined;
  accountEmail: string | null;
  onAdd: (email: string, name?: string) => void;
  inline?: boolean;
}) {
  let inputRef: HTMLInputElement | undefined;
  const [inputValue, setInputValue] = createSignal("");
  const [query, setQuery] = createSignal("");
  const [suggestions, setSuggestions] = createSignal<ContactSuggestion[]>([]);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let zeroStateCache: ContactSuggestion[] | null = null;
  // Only mirror highlighted item into input on explicit navigation (hover/arrow),
  // not when autohighlight fires after typing.
  let userNavigated = false;

  onCleanup(() => clearTimeout(debounceTimer));

  const existingEmails = createMemo(() =>
    new Set((props.attendees ?? []).map(a => a.email.toLowerCase()))
  );

  const filtered = createMemo(() =>
    suggestions().filter(c => !existingEmails().has(c.email.toLowerCase()))
  );

  const items = createMemo(() =>
    filtered().map(c => ({ value: c.email, name: c.name }))
  );

  const collection = createMemo(() => {
    const q = query().toLowerCase();
    return createListCollection({
      items: items(),
      itemToValue: (item) => item.value,
      itemToString: (item) => q ? `${q} ${item.value}` : item.value,
    });
  });

  async function fetchSuggestions(q: string): Promise<void> {
    if (q === "" && zeroStateCache) {
      setSuggestions(zeroStateCache);
      return;
    }
    try {
      const result = await apiFetch<{ contacts: ContactSuggestion[] }>(
        `/api/contacts/suggestions?q=${encodeURIComponent(q)}&limit=8`
      );
      if (q === "") zeroStateCache = result.contacts;
      setSuggestions(result.contacts);
    } catch {
      // API error — fall back to raw email input behavior
    }
  }

  function debouncedFetch(q: string): void {
    clearTimeout(debounceTimer);
    if (q === "") {
      fetchSuggestions("").catch(() => {});
      return;
    }
    debounceTimer = setTimeout(() => {
      fetchSuggestions(q).catch(() => {});
    }, 200);
  }

  function handleAdd(email: string, name?: string): void {
    const trimmed = email.trim();
    if (!trimmed || !isValidEmail(trimmed)) return;
    props.onAdd(trimmed, name || undefined);
    setInputValue("");
    setQuery("");
    setSuggestions(zeroStateCache ?? []);
  }

  return (
    <Combobox.Root
      collection={collection()}
      value={[]}
      allowCustomValue
      openOnClick
      closeOnSelect
      inputBehavior="autohighlight"
      onHighlightChange={(d) => {
        if (d.highlightedValue != null && userNavigated) {
          const item = items().find((i) => i.value === d.highlightedValue);
          if (item) {
            setInputValue(item.name || item.value);
            requestAnimationFrame(() => inputRef?.select());
          }
        }
      }}
      inputValue={inputValue()}
      onInputValueChange={(d) => {
        userNavigated = false;
        setInputValue(d.inputValue);
        setQuery(d.inputValue);
        debouncedFetch(d.inputValue.trim());
      }}
      onValueChange={(details) => {
        const email = details.value[0];
        if (!email) return;
        const contact = filtered().find(c => c.email === email);
        handleAdd(email, contact?.name ?? undefined);
      }}
      onOpenChange={(d) => {
        if (d.open) {
          debouncedFetch("");
        } else {
          // Try to add any remaining email-like text (handles blur-to-add)
          const val = inputValue().trim();
          if (val && isValidEmail(val)) {
            handleAdd(val);
          }
          setInputValue("");
          setQuery("");
        }
      }}
      positioning={{ placement: "bottom-start", sameWidth: true }}
    >
      <Combobox.Control class={props.inline
        ? "flex items-center gap-2 text-sm rounded px-2 py-2 hover:bg-surface-hover focus-within:bg-surface-hover transition-colors"
        : "pl-[30px] pr-2"
      }>
        <Show when={props.inline}>
          <Users size={14} class="text-fg-muted shrink-0" />
        </Show>
        <Combobox.Input
          ref={(el) => { inputRef = el; }}
          placeholder={props.inline ? "Participants" : "Add participant"}
          aria-label="Add participants"
          autocomplete="off"
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              userNavigated = true;
            } else if (e.key === "Escape") {
              e.preventDefault();
              setInputValue("");
              setQuery("");
              (e.target as HTMLElement).blur();
            } else if (e.key === "Enter") {
              const val = inputValue().trim();
              if (val && isValidEmail(val)) {
                e.preventDefault();
                const contact = filtered().find(c => c.email.toLowerCase() === val.toLowerCase());
                handleAdd(val, contact?.name ?? undefined);
                return;
              }
              // Non-email text with suggestions visible — let Combobox handle
            }
          }}
          class={`flex-1 w-full text-sm text-fg placeholder-fg-disabled bg-transparent outline-none border-none ${props.inline ? "py-0" : "py-1.5"}`}
        />
      </Combobox.Control>
      <Combobox.Positioner>
        <Show when={items().length > 0}>
          <Combobox.Content
            class="bg-surface border border-border rounded py-1 z-50 max-h-48 overflow-y-auto"
            onPointerMove={() => { userNavigated = true; }}
          >
            <For each={items()}>
              {(item) => {
                const isSelf = () => props.accountEmail != null && item.value.toLowerCase() === props.accountEmail;
                return (
                  <Combobox.Item
                    item={item}
                    class="flex flex-col px-3 py-1.5 cursor-pointer hover:bg-surface-hover data-[highlighted]:bg-surface-hover outline-none"
                  >
                    <div class="flex items-center gap-1.5">
                      <Combobox.ItemText class="text-xs text-fg">
                        {item.name || item.value}
                      </Combobox.ItemText>
                      <Show when={isSelf()}>
                        <span class="text-2xs text-fg-disabled">(You)</span>
                      </Show>
                    </div>
                    <Show when={item.name}>
                      <span class="text-2xs text-fg-disabled">{item.value}</span>
                    </Show>
                  </Combobox.Item>
                );
              }}
            </For>
          </Combobox.Content>
        </Show>
      </Combobox.Positioner>
    </Combobox.Root>
  );
}

const RSVP_LABELS: Record<string, { button: string; silent: string; notifyPrefix: string }> = {
  accepted: { button: "Accept", silent: "Accept without notifying", notifyPrefix: "Accept & notify" },
  tentative: { button: "Maybe", silent: "Respond tentatively without notifying", notifyPrefix: "Respond tentatively & notify" },
  declined: { button: "Decline", silent: "Decline without notifying", notifyPrefix: "Decline & notify" },
};

function RsvpButtons(props: {
  currentStatus: Attendee["responseStatus"];
  organizerName: string;
  onRsvp: (status: "accepted" | "declined" | "tentative", sendUpdates: "all" | "none") => void;
}) {
  const buttonClass = (status: string) => {
    const isActive = props.currentStatus === status;
    return `flex-1 text-xs py-1.5 rounded transition-colors cursor-pointer border-none outline-none ${
      isActive
        ? "bg-fg text-surface font-medium"
        : "bg-surface-hover text-fg-muted hover:text-fg"
    }`;
  };

  return (
    <div
      class="flex gap-1 pl-[30px] pr-2 pt-1"
      role="group"
      aria-label="Your response"
    >
      <For each={["accepted", "tentative", "declined"] as const}>
        {(status) => (
          <Popover.Root positioning={{ placement: "top" }}>
            <Popover.Trigger
              class={buttonClass(status)}
              aria-pressed={props.currentStatus === status}
            >
              {RSVP_LABELS[status].button}
            </Popover.Trigger>
            <Popover.Positioner>
              <Popover.Content
                class="bg-surface border border-border rounded-lg shadow-lg z-50 w-64 py-2"
                aria-label="Choose how to respond to this invitation"
              >
                {/* Cancel */}
                <Popover.CloseTrigger
                  class="w-full text-left text-sm text-fg-muted hover:bg-surface-hover px-3 py-2 transition-colors cursor-pointer border-none outline-none bg-transparent"
                >
                  Cancel
                </Popover.CloseTrigger>

                {/* Notify organizer */}
                <Popover.CloseTrigger
                  class="w-full text-left text-sm text-fg hover:bg-surface-hover px-3 py-2 transition-colors cursor-pointer border-none outline-none bg-transparent"
                  onClick={() => props.onRsvp(status, "all")}
                >
                  {RSVP_LABELS[status].notifyPrefix} {props.organizerName}
                </Popover.CloseTrigger>

                {/* Primary: without notifying */}
                <div class="px-3 pt-1 pb-1">
                  <div class="flex items-center rounded-lg bg-accent hover:bg-accent/90 transition-colors">
                    <Popover.CloseTrigger
                      class="flex-1 text-sm py-2 px-3 text-white font-medium text-left cursor-pointer border-none outline-none bg-transparent"
                      onClick={() => props.onRsvp(status, "none")}
                    >
                      {RSVP_LABELS[status].silent}
                    </Popover.CloseTrigger>
                    <Tooltip.Root openDelay={200} positioning={{ placement: "top" }}>
                      <Tooltip.Trigger
                        class="text-white/50 hover:text-white/80 transition-colors cursor-help bg-transparent border-none outline-none p-1 pr-2.5"
                        aria-label="What does this mean?"
                      >
                        <Info size={14} />
                      </Tooltip.Trigger>
                      <Tooltip.Positioner>
                        <Tooltip.Content class="bg-fg text-surface text-xs rounded px-2 py-1 max-w-52 z-50">
                          {props.organizerName} will see your response on their next calendar sync. No email is sent.
                        </Tooltip.Content>
                      </Tooltip.Positioner>
                    </Tooltip.Root>
                  </div>
                </div>
              </Popover.Content>
            </Popover.Positioner>
          </Popover.Root>
        )}
      </For>
    </div>
  );
}
