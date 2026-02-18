import { createSignal, createMemo } from "solid-js";
import { events } from "./events";
import { isCreating, cancelCreation, draftTitle, commitCreation } from "./event-creation";
import type { CalendarEvent } from "./event-types";

// =============================================================================
// Signals
// =============================================================================

export const [popoverEventId, setPopoverEventId] = createSignal<string | null>(null);
export const [popoverAnchorEl, setPopoverAnchorEl] = createSignal<HTMLElement | null>(null);
export const [editSheetEventId, setEditSheetEventId] = createSignal<string | null>(null);

// =============================================================================
// Derived
// =============================================================================

export const popoverEvent = createMemo((): CalendarEvent | null => {
  const id = popoverEventId();
  if (!id) return null;
  return events().find((e) => e.id === id) ?? null;
});

export const isPopoverOpen = createMemo(() => popoverEventId() !== null);

export const isEditSheetOpen = createMemo(() => editSheetEventId() !== null);

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

/**
 * Transition from detail popover to edit sheet.
 * Closes the popover and opens the sheet for the same event.
 */
export function openEditSheet(eventId: string): void {
  closeEventPopover();
  setEditSheetEventId(eventId);
}

/**
 * Close the edit sheet.
 */
export function closeEditSheet(): void {
  setEditSheetEventId(null);
}
