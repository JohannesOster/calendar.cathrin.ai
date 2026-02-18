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
export const [editSheetAnchorEl, setEditSheetAnchorEl] = createSignal<HTMLElement | null>(null);
export const [creationSheetOpen, setCreationSheetOpen] = createSignal(false);

// =============================================================================
// Derived
// =============================================================================

export const popoverEvent = createMemo((): CalendarEvent | null => {
  const id = popoverEventId();
  if (!id) return null;
  return events().find((e) => e.id === id) ?? null;
});

export const isPopoverOpen = createMemo(() => popoverEventId() !== null);

export const isEditSheetOpen = createMemo(() => editSheetEventId() !== null || creationSheetOpen());

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
 * Open the edit popover anchored to the event chip.
 * Closes the detail popover if open.
 */
export function openEditSheet(eventId: string, anchorEl?: HTMLElement): void {
  closeEventPopover();
  setEditSheetEventId(eventId);
  if (anchorEl) setEditSheetAnchorEl(anchorEl);
}

/**
 * Open the edit sheet in creation mode.
 */
export function openCreationSheet(anchorEl?: HTMLElement): void {
  if (anchorEl) setEditSheetAnchorEl(anchorEl);
  setCreationSheetOpen(true);
}

/**
 * Close the edit sheet (both edit and creation modes).
 */
export function closeEditSheet(): void {
  setEditSheetEventId(null);
  setEditSheetAnchorEl(null);
  setCreationSheetOpen(false);
}
