import { AUTO_SCROLL_EDGE_PX, AUTO_SCROLL_MAX_SPEED } from "../constants/calendar";

/**
 * Lightweight rAF-based auto-scroll for drag-to-create.
 *
 * While active, a requestAnimationFrame loop checks if the cached cursor
 * position is within the edge zones of the scroll container and scrolls
 * accordingly. Speed scales linearly — faster closer to the edge.
 *
 * The `onTick` callback fires whenever scrollTop actually changes so the
 * caller can recalculate the draft event position.
 */

let rafId: number | null = null;
let container: HTMLElement | null = null;
let cursorY = 0;
let topEdge = 0;
let bottomEdge = 0;
let onTickCb: (() => void) | null = null;

function tick() {
  if (!container) return;

  let delta = 0;

  // Distance into the top edge zone (positive = inside zone)
  const distFromTop = topEdge + AUTO_SCROLL_EDGE_PX - cursorY;
  // Distance into the bottom edge zone (positive = inside zone)
  const distFromBottom = cursorY - (bottomEdge - AUTO_SCROLL_EDGE_PX);

  if (distFromTop > 0) {
    // Scroll up — speed proportional to how deep into the zone the cursor is
    const ratio = Math.min(distFromTop / AUTO_SCROLL_EDGE_PX, 1);
    delta = -Math.round(AUTO_SCROLL_MAX_SPEED * ratio);
  } else if (distFromBottom > 0) {
    // Scroll down
    const ratio = Math.min(distFromBottom / AUTO_SCROLL_EDGE_PX, 1);
    delta = Math.round(AUTO_SCROLL_MAX_SPEED * ratio);
  }

  if (delta !== 0) {
    const before = container.scrollTop;
    container.scrollTop += delta;
    if (container.scrollTop !== before) {
      onTickCb?.();
    }
  }

  rafId = requestAnimationFrame(tick);
}

/**
 * Start the auto-scroll loop (idempotent — safe to call on every mousemove).
 */
export function startAutoScroll(
  scrollContainer: HTMLElement,
  stickyHeight: number,
  onTick: () => void,
): void {
  container = scrollContainer;
  onTickCb = onTick;
  updateAutoScrollBounds(stickyHeight);

  // Only start one loop
  if (rafId !== null) return;
  rafId = requestAnimationFrame(tick);
}

/**
 * Update the cached cursor Y (called from mousemove).
 */
export function updateAutoScrollCursor(clientY: number): void {
  cursorY = clientY;
}

/**
 * Refresh the edge boundaries (e.g. when sticky header height changes).
 */
export function updateAutoScrollBounds(stickyHeight: number): void {
  if (!container) return;
  const rect = container.getBoundingClientRect();
  topEdge = rect.top + stickyHeight;
  bottomEdge = rect.bottom;
}

/**
 * Stop the auto-scroll loop and clear all state.
 */
export function stopAutoScroll(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  container = null;
  onTickCb = null;
  cursorY = 0;
}
