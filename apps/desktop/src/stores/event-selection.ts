import { createSignal, createMemo } from "solid-js";
import { events } from "./events";
import { isCreating, cancelCreation, draftTitle, commitCreation } from "./event-creation";
import { openEventPopover, closeEventPopover, openEditSheet, closeEditSheet } from "./event-popover";

// =============================================================================
// Signals
// =============================================================================
export const [selectedEventId, setSelectedEventId] = createSignal<string | null>(null);

// =============================================================================
// Derived
// =============================================================================

/** The full event object for the currently selected event, or null */
export const selectedEvent = createMemo(() => {
  const id = selectedEventId();
  if (!id) return null;
  return events().find((e) => e.id === id) ?? null;
});

// =============================================================================
// Actions
// =============================================================================

/**
 * Select an event. Editable events open the edit sheet directly;
 * read-only events open the detail popover.
 * If an event creation is active, commits/cancels it first.
 */
export function selectEvent(eventId: string, anchorEl: HTMLElement): void {
  // Already selected — ignore re-clicks on the same event chip
  if (selectedEventId() === eventId) return;

  // If creating, handle the active draft
  if (isCreating()) {
    if (draftTitle().trim()) {
      commitCreation();
    } else {
      cancelCreation();
    }
  }

  // Close any open popover/edit sheet before opening the new one
  closeEventPopover();
  closeEditSheet();

  const event = events().find((e) => e.id === eventId);
  setSelectedEventId(eventId);

  if (event?.isReadOnly) {
    openEventPopover(eventId, anchorEl);
  } else {
    openEditSheet(eventId, anchorEl);
  }
}

/**
 * Deselect the current event and close popover/sheet.
 */
export function deselectEvent(): void {
  setSelectedEventId(null);
  closeEventPopover();
}
