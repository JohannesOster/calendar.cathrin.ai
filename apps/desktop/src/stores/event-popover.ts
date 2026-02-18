import { createSignal, createMemo } from "solid-js";
import { events } from "./events";
import { isCreating, cancelCreation, draftTitle, commitCreation } from "./event-creation";
import type { CalendarEvent } from "./event-types";

// =============================================================================
// Signals
// =============================================================================

export const [popoverEventId, setPopoverEventId] = createSignal<string | null>(null);
export const [popoverAnchorEl, setPopoverAnchorEl] = createSignal<HTMLElement | null>(null);

// =============================================================================
// Derived
// =============================================================================

export const popoverEvent = createMemo((): CalendarEvent | null => {
  const id = popoverEventId();
  if (!id) return null;
  return events().find((e) => e.id === id) ?? null;
});

export const isPopoverOpen = createMemo(() => popoverEventId() !== null);

// =============================================================================
// Actions
// =============================================================================

/**
 * Open the event detail popover anchored to the given element.
 * If a creation draft is active, commits/cancels it first.
 */
export function openEventPopover(eventId: string, anchorEl: HTMLElement): void {
  // Handle active creation draft
  if (isCreating()) {
    if (draftTitle().trim()) {
      commitCreation();
    } else {
      cancelCreation();
    }
  }

  setPopoverEventId(eventId);
  setPopoverAnchorEl(anchorEl);
}

/**
 * Close the event detail popover.
 */
export function closeEventPopover(): void {
  setPopoverEventId(null);
  setPopoverAnchorEl(null);
}
