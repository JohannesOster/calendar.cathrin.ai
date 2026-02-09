import { createSignal } from "solid-js";
import type { CalendarEvent } from "./events";

// =============================================================================
// Types
// =============================================================================

export interface DragState {
  event: CalendarEvent;
  /** Original start before drag began */
  originalStart: Date;
  /** Original end before drag began */
  originalEnd: Date;
  /** Minutes offset from event start to cursor position at drag start */
  cursorOffsetMinutes: number;
}

// =============================================================================
// Signals
// =============================================================================

export const [moveDrag, setMoveDrag] = createSignal<DragState | null>(null);

// =============================================================================
// Derived
// =============================================================================

export function isMoveDragging(): boolean {
  return moveDrag() !== null;
}

export function moveDragEventId(): string | null {
  return moveDrag()?.event.id ?? null;
}

// =============================================================================
// Actions
// =============================================================================

/**
 * Start dragging an event to move it.
 * @param event The event being dragged
 * @param cursorMinutes The time in minutes where the cursor grabbed the event
 */
export function startMoveDrag(event: CalendarEvent, cursorMinutes: number): void {
  const eventStartMinutes = event.start.getHours() * 60 + event.start.getMinutes();
  setMoveDrag({
    event,
    originalStart: new Date(event.start),
    originalEnd: new Date(event.end),
    cursorOffsetMinutes: cursorMinutes - eventStartMinutes,
  });
}

/**
 * Cancel the move drag — revert to original position.
 */
export function cancelMoveDrag(): void {
  setMoveDrag(null);
}

/**
 * Finish the move drag — keep the new position.
 * Returns the drag state for the caller to persist the update.
 */
export function finishMoveDrag(): DragState | null {
  const state = moveDrag();
  setMoveDrag(null);
  return state;
}
