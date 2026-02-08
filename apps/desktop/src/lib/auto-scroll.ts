import { AUTO_SCROLL_EDGE_PX, AUTO_SCROLL_MAX_SPEED } from "../constants/calendar";

/**
 * Lightweight rAF-based auto-scroll for drag-to-create.
 *
 * While active, a requestAnimationFrame loop checks if the cached cursor
 * position is within the edge zones of the scroll container and scrolls
 * accordingly (both vertically and horizontally). Speed scales linearly —
 * faster closer to the edge.
 *
 * Horizontal scrolling snaps to column boundaries: pixel deltas accumulate
 * in a buffer and jump by one full column width once the buffer crosses
 * the halfway threshold. This gives a clean column-by-column stepping feel.
 *
 * The `onTick` callback fires whenever scrollTop or scrollLeft actually
 * changes so the caller can recalculate the draft event position.
 */

let rafId: number | null = null;
let container: HTMLElement | null = null;
let cursorY = 0;
let cursorX = 0;
let topEdge = 0;
let bottomEdge = 0;
let leftEdge = 0;
let rightEdge = 0;
let onTickCb: (() => void) | null = null;
let hSnapWidth = 0; // column width for horizontal snapping (0 = smooth)
let hBuffer = 0; // accumulated horizontal pixels toward next snap

function tick() {
  if (!container) return;

  let changed = false;

  // --- Vertical auto-scroll ---
  let deltaY = 0;

  // Distance into the top edge zone (positive = inside zone)
  const distFromTop = topEdge + AUTO_SCROLL_EDGE_PX - cursorY;
  // Distance into the bottom edge zone (positive = inside zone)
  const distFromBottom = cursorY - (bottomEdge - AUTO_SCROLL_EDGE_PX);

  if (distFromTop > 0) {
    // Scroll up — speed proportional to how deep into the zone the cursor is
    const ratio = Math.min(distFromTop / AUTO_SCROLL_EDGE_PX, 1);
    deltaY = -Math.round(AUTO_SCROLL_MAX_SPEED * ratio);
  } else if (distFromBottom > 0) {
    // Scroll down
    const ratio = Math.min(distFromBottom / AUTO_SCROLL_EDGE_PX, 1);
    deltaY = Math.round(AUTO_SCROLL_MAX_SPEED * ratio);
  }

  if (deltaY !== 0) {
    const before = container.scrollTop;
    container.scrollTop += deltaY;
    if (container.scrollTop !== before) changed = true;
  }

  // --- Horizontal auto-scroll (column-snapping) ---
  let rawDeltaX = 0;

  const distFromLeft = leftEdge + AUTO_SCROLL_EDGE_PX - cursorX;
  const distFromRight = cursorX - (rightEdge - AUTO_SCROLL_EDGE_PX);

  if (distFromLeft > 0) {
    const ratio = Math.min(distFromLeft / AUTO_SCROLL_EDGE_PX, 1);
    rawDeltaX = -Math.round(AUTO_SCROLL_MAX_SPEED * ratio);
  } else if (distFromRight > 0) {
    const ratio = Math.min(distFromRight / AUTO_SCROLL_EDGE_PX, 1);
    rawDeltaX = Math.round(AUTO_SCROLL_MAX_SPEED * ratio);
  }

  if (rawDeltaX !== 0 && hSnapWidth > 0) {
    // Accumulate pixels in buffer; jump by one column when threshold crossed
    hBuffer += rawDeltaX;
    const threshold = hSnapWidth / 2;
    if (Math.abs(hBuffer) >= threshold) {
      const columns = Math.sign(hBuffer); // +1 or -1 column at a time
      const before = container.scrollLeft;
      container.scrollLeft += columns * hSnapWidth;
      hBuffer = 0;
      if (container.scrollLeft !== before) changed = true;
    }
  } else if (rawDeltaX !== 0) {
    // Fallback: smooth scroll if no snap width configured
    const before = container.scrollLeft;
    container.scrollLeft += rawDeltaX;
    if (container.scrollLeft !== before) changed = true;
  } else {
    // Cursor left the edge zone — reset buffer so next entry starts fresh
    hBuffer = 0;
  }

  if (changed) {
    onTickCb?.();
  }

  rafId = requestAnimationFrame(tick);
}

/**
 * Start the auto-scroll loop (idempotent — safe to call on every mousemove).
 * @param stickyHeight - Height of sticky header area (top edge starts below it)
 * @param stickyLeftWidth - Width of sticky time column (left edge starts after it)
 * @param columnWidth - Width of a day column for horizontal snap-stepping (0 = smooth)
 */
export function startAutoScroll(
  scrollContainer: HTMLElement,
  stickyHeight: number,
  onTick: () => void,
  stickyLeftWidth: number = 0,
  columnWidth: number = 0,
): void {
  container = scrollContainer;
  onTickCb = onTick;
  hSnapWidth = columnWidth;
  updateAutoScrollBounds(stickyHeight, stickyLeftWidth);

  // Only start one loop
  if (rafId !== null) return;
  rafId = requestAnimationFrame(tick);
}

/**
 * Update the cached cursor position (called from mousemove).
 */
export function updateAutoScrollCursor(clientY: number, clientX?: number): void {
  cursorY = clientY;
  if (clientX !== undefined) cursorX = clientX;
}

/**
 * Refresh the edge boundaries (e.g. when sticky header height changes).
 */
export function updateAutoScrollBounds(stickyHeight: number, stickyLeftWidth: number = 0): void {
  if (!container) return;
  const rect = container.getBoundingClientRect();
  topEdge = rect.top + stickyHeight;
  bottomEdge = rect.bottom;
  leftEdge = rect.left + stickyLeftWidth;
  rightEdge = rect.right;
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
  cursorX = 0;
  hBuffer = 0;
}
