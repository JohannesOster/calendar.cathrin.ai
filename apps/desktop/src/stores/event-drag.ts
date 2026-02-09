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

export interface ResizeState {
  event: CalendarEvent;
  /** Original start (stays fixed during resize) */
  originalStart: Date;
  /** Original end before resize began */
  originalEnd: Date;
}

// =============================================================================
// Signals
// =============================================================================

export const [moveDrag, setMoveDrag] = createSignal<DragState | null>(null);
export const [resizeDrag, setResizeDrag] = createSignal<ResizeState | null>(null);

// =============================================================================
// Derived
// =============================================================================

export function isMoveDragging(): boolean {
  return moveDrag() !== null;
}

export function moveDragEventId(): string | null {
  return moveDrag()?.event.id ?? null;
}

export function isResizeDragging(): boolean {
  return resizeDrag() !== null;
}

export function resizeDragEventId(): string | null {
  return resizeDrag()?.event.id ?? null;
}

/** Any drag in progress (move or resize) */
export function isDragActive(): boolean {
  return moveDrag() !== null || resizeDrag() !== null;
}

/** Event ID being dragged (move or resize) */
export function dragActiveEventId(): string | null {
  return moveDrag()?.event.id ?? resizeDrag()?.event.id ?? null;
}

// =============================================================================
// Move Actions
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

// =============================================================================
// Resize Actions
// =============================================================================

/**
 * Start resizing an event (bottom edge).
 */
export function startResizeDrag(event: CalendarEvent): void {
  setResizeDrag({
    event,
    originalStart: new Date(event.start),
    originalEnd: new Date(event.end),
  });
}

/**
 * Cancel the resize drag — revert to original size.
 */
export function cancelResizeDrag(): void {
  setResizeDrag(null);
}

/**
 * Finish the resize drag — keep the new size.
 * Returns the resize state for the caller to persist the update.
 */
export function finishResizeDrag(): ResizeState | null {
  const state = resizeDrag();
  setResizeDrag(null);
  return state;
}
