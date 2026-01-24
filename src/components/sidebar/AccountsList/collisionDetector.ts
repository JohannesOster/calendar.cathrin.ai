import type { CollisionDetector, Droppable } from "@thisbeyond/solid-dnd";
import { SIDEBAR } from "../../../constants/sidebar";

/**
 * Record of a recent swap, used for hysteresis to prevent jitter
 */
export interface SwapRecord {
  fromId: string;
  toId: string;
  pointerY: number;
  direction: "down" | "up"; // down = fromIndex < toIndex
}

/**
 * Creates a collision detector with hysteresis to prevent rapid back-and-forth swaps
 * Uses intersection + closestCenter logic
 */
export function createHysteresisCollisionDetector(
  getLastSwap: () => SwapRecord | null
): CollisionDetector {
  return (draggable, droppables, _context) => {
    const draggableLayout = draggable.transformed ?? draggable.layout;
    if (!draggableLayout) return null;

    // IMPORTANT: Use placeholder height (32px), not the stale transformed.height
    // When dragging an expanded account, the DOM shows a 32px placeholder,
    // but transformed.height still contains the old expanded height
    const draggableTop = draggableLayout.y;
    const draggableBottom = draggableLayout.y + SIDEBAR.PLACEHOLDER_HEIGHT;
    const draggableCenter = draggableLayout.y + SIDEBAR.PLACEHOLDER_HEIGHT / 2;

    const closestDroppable = findClosestOverlapping(
      droppables,
      draggable.id,
      draggableTop,
      draggableBottom,
      draggableCenter
    );

    if (!closestDroppable) return null;

    // Check if this would be blocked by hysteresis
    const lastSwap = getLastSwap();
    if (lastSwap && isBlockedByHysteresis(lastSwap, draggable.id as string, closestDroppable, draggableCenter)) {
      return null;
    }

    return closestDroppable;
  };
}

/**
 * Find the closest droppable that overlaps with the draggable
 */
function findClosestOverlapping(
  droppables: readonly Droppable[],
  draggableId: string | number,
  draggableTop: number,
  draggableBottom: number,
  draggableCenter: number
): Droppable | null {
  let closest: Droppable | null = null;
  let minDistance = Infinity;

  for (const droppable of droppables) {
    if (droppable.id === draggableId) continue;

    const droppableLayout = droppable.layout;
    if (!droppableLayout) continue;

    const droppableTop = droppableLayout.y;
    const droppableBottom = droppableLayout.y + droppableLayout.height;

    // Check if draggable overlaps with this droppable (vertical intersection)
    const hasOverlap = draggableBottom > droppableTop && draggableTop < droppableBottom;
    if (!hasOverlap) continue;

    const droppableCenter = droppableLayout.y + droppableLayout.height / 2;
    const distance = Math.abs(draggableCenter - droppableCenter);

    if (distance < minDistance) {
      minDistance = distance;
      closest = droppable;
    }
  }

  return closest;
}

/**
 * Check if a potential swap should be blocked due to hysteresis
 * (preventing rapid back-and-forth swaps)
 */
function isBlockedByHysteresis(
  lastSwap: SwapRecord,
  draggableId: string,
  targetDroppable: Droppable,
  draggableCenter: number
): boolean {
  // Reverse swap = same draggable trying to swap with the same target again
  const isReverseSwap =
    lastSwap.fromId === draggableId &&
    lastSwap.toId === (targetDroppable.id as string);

  if (!isReverseSwap) return false;

  // Get the current center of the target we previously swapped with
  const targetLayout = targetDroppable.layout;
  if (!targetLayout) return false;

  const targetCenter = targetLayout.y + targetLayout.height / 2;

  // Require the draggable to move past the target's center by the threshold
  if (lastSwap.direction === "down") {
    // Original swap was downward, reverse requires moving UP past the target
    if (draggableCenter > targetCenter - SIDEBAR.HYSTERESIS_THRESHOLD) {
      return true; // Not far enough up - block the swap
    }
  } else {
    // Original swap was upward, reverse requires moving DOWN past the target
    if (draggableCenter < targetCenter + SIDEBAR.HYSTERESIS_THRESHOLD) {
      return true; // Not far enough down - block the swap
    }
  }

  return false;
}
