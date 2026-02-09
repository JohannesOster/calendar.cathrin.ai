import { createSignal, createMemo } from "solid-js";
import { events } from "./events";
import { setRightSidebarOpen } from "../components/layout/AppShell";
import { isCreating, cancelCreation, draftTitle, commitCreation } from "./event-creation";

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
 * Select an event — opens the right sidebar with event details.
 * If an event creation is active, commits/cancels it first.
 */
export function selectEvent(eventId: string): void {
  // If creating, handle the active draft
  if (isCreating()) {
    if (draftTitle().trim()) {
      commitCreation();
    } else {
      cancelCreation();
    }
  }

  setSelectedEventId(eventId);
  setRightSidebarOpen(true);
}

/**
 * Deselect the current event — closes the sidebar (unless creating).
 */
export function deselectEvent(): void {
  setSelectedEventId(null);
}
