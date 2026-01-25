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
 * Creates a collision detector that handles both accounts and calendars
 * with different strategies for each:
 *
 * - Accounts: Overlap + closest center with hysteresis (original approach)
 * - Calendars: Trigger zones at top/bottom (works well with auto-animate)
 *
 * @param isAccountId - Function to check if an ID belongs to an account (vs calendar)
 * @param getLastSwap - Function to get the last swap record for hysteresis (accounts only)
 */
export function createTriggerZoneCollisionDetector(
  isAccountId: (id: string) => boolean,
  getLastSwap: () => SwapRecord | null
): CollisionDetector {
  return (draggable, droppables, _context) => {
    const draggableLayout = draggable.transformed ?? draggable.layout;
    if (!draggableLayout) return null;

    const isAccount = isAccountId(draggable.id as string);

    // Filter droppables to only same type (accounts with accounts, calendars with calendars)
    const sameTypeDroppables = droppables.filter(
      (d) => isAccountId(d.id as string) === isAccount
    );

    if (isAccount) {
      // Accounts: Use overlap + closest center with hysteresis (original approach)
      const itemHeight = SIDEBAR.PLACEHOLDER_HEIGHT;
      const draggableTop = draggableLayout.y;
      const draggableBottom = draggableLayout.y + itemHeight;
      const draggableCenter = draggableLayout.y + itemHeight / 2;

      const closestDroppable = findClosestOverlapping(
        sameTypeDroppables,
        draggable.id,
        draggableTop,
        draggableBottom,
        draggableCenter
      );

      if (!closestDroppable) return null;

      // Check if this would be blocked by hysteresis
      const lastSwap = getLastSwap();
      if (
        lastSwap &&
        isBlockedByHysteresis(
          lastSwap,
          draggable.id as string,
          closestDroppable,
          draggableCenter
        )
      ) {
        return null;
      }

      return closestDroppable;
    } else {
      // Calendars: Use trigger zones
      const itemHeight = SIDEBAR.CALENDAR_ROW_HEIGHT;
      const draggableCenter = draggableLayout.y + itemHeight / 2;

      return findDroppableInTriggerZone(
        sameTypeDroppables,
        draggable.id,
        draggableCenter
      );
    }
  };
}

/**
 * Find the closest droppable that overlaps with the draggable.
 * Used for ACCOUNT dragging.
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

    const layout = droppable.layout;
    if (!layout) continue;

    const droppableTop = layout.y;
    const droppableBottom = layout.y + layout.height;

    // Check if draggable overlaps with this droppable (vertical intersection)
    const hasOverlap =
      draggableBottom > droppableTop && draggableTop < droppableBottom;
    if (!hasOverlap) continue;

    const droppableCenter = layout.y + layout.height / 2;
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

/**
 * Find a droppable whose trigger zone contains the draggable's center.
 * Trigger zones are the top/bottom TRIGGER_ZONE_PERCENT of each item.
 * Returns null if we're in any item's dead zone (the middle portion).
 * Used for CALENDAR dragging.
 */
function findDroppableInTriggerZone(
  droppables: readonly Droppable[],
  draggableId: string | number,
  draggableCenter: number
): Droppable | null {
  for (const droppable of droppables) {
    if (droppable.id === draggableId) continue;

    const layout = droppable.layout;
    if (!layout) continue;

    const top = layout.y;
    const bottom = layout.y + layout.height;
    const triggerSize = layout.height * SIDEBAR.TRIGGER_ZONE_PERCENT;

    // Top trigger zone: swap when dragging DOWN into this item
    const topZoneEnd = top + triggerSize;
    // Bottom trigger zone: swap when dragging UP into this item
    const bottomZoneStart = bottom - triggerSize;

    // Check if draggable center is in top trigger zone
    if (draggableCenter >= top && draggableCenter <= topZoneEnd) {
      return droppable;
    }

    // Check if draggable center is in bottom trigger zone
    if (draggableCenter >= bottomZoneStart && draggableCenter <= bottom) {
      return droppable;
    }
  }

  return null;
}
