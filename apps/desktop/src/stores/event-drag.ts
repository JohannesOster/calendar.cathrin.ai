import { createSignal } from "solid-js";
import type { CalendarEvent } from "./event-types";

// =============================================================================
// Types
// =============================================================================

interface DragState {
  event: CalendarEvent;
  /** Original start before drag began */
  originalStart: Date;
  /** Original end before drag began */
  originalEnd: Date;
  /** Minutes offset from event start to cursor position at drag start */
  cursorOffsetMinutes: number;
}

interface ResizeState {
  event: CalendarEvent;
  /** Original start (stays fixed during resize) */
  originalStart: Date;
  /** Original end before resize began */
  originalEnd: Date;
}

interface AllDayUnfoldState {
  event: CalendarEvent;
  originalStart: Date;
  originalEnd: Date;
  /** Which chip edge initiated the drag */
  edge: "start" | "end";
}

// =============================================================================
// Signals
// =============================================================================

export const [moveDrag, setMoveDrag] = createSignal<DragState | null>(null);
export const [resizeDrag, setResizeDrag] = createSignal<ResizeState | null>(null);
export const [unfoldDrag, setUnfoldDrag] = createSignal<AllDayUnfoldState | null>(null);

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

export function isUnfolding(): boolean {
  return unfoldDrag() !== null;
}

export function unfoldDragEventId(): string | null {
  return unfoldDrag()?.event.id ?? null;
}

/** Any drag in progress (move, resize, or unfold) */
export function isDragActive(): boolean {
  return moveDrag() !== null || resizeDrag() !== null || unfoldDrag() !== null;
}

/** Event ID being dragged (move, resize, or unfold) */
export function dragActiveEventId(): string | null {
  return moveDrag()?.event.id ?? resizeDrag()?.event.id ?? unfoldDrag()?.event.id ?? null;
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

// =============================================================================
// Unfold Actions (multi-day timed chip → time grid)
// =============================================================================

/**
 * Start unfolding a multi-day timed chip into the time grid.
 */
export function startUnfoldDrag(event: CalendarEvent, edge: "start" | "end"): void {
  setUnfoldDrag({
    event,
    originalStart: new Date(event.start),
    originalEnd: new Date(event.end),
    edge,
  });
}

/**
 * Cancel the unfold drag — revert to original position.
 */
export function cancelUnfoldDrag(): void {
  setUnfoldDrag(null);
}

/**
 * Finish the unfold drag — keep the new position.
 * Returns the unfold state for the caller to persist the update.
 */
export function finishUnfoldDrag(): AllDayUnfoldState | null {
  const state = unfoldDrag();
  setUnfoldDrag(null);
  return state;
}
