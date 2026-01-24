import type { CollisionDetector, Droppable } from "@thisbeyond/solid-dnd";
import { SIDEBAR } from "../../../constants/sidebar";

/**
 * Creates a collision detector using trigger zones.
 *
 * Swaps only happen when the dragged item's center enters the
 * top or bottom trigger zone of another item. The middle is a
 * "dead zone" where no swap occurs.
 *
 * This prevents jitter naturally without needing hysteresis.
 *
 * @param isAccountId - Function to check if an ID belongs to an account (vs calendar)
 */
export function createTriggerZoneCollisionDetector(
  isAccountId: (id: string) => boolean
): CollisionDetector {
  return (draggable, droppables, _context) => {
    const draggableLayout = draggable.transformed ?? draggable.layout;
    if (!draggableLayout) return null;

    // Use the appropriate height based on what's being dragged
    const isAccount = isAccountId(draggable.id as string);
    const itemHeight = isAccount
      ? SIDEBAR.PLACEHOLDER_HEIGHT
      : SIDEBAR.CALENDAR_ROW_HEIGHT;

    const draggableCenter = draggableLayout.y + itemHeight / 2;

    // Filter droppables to only same type (accounts with accounts, calendars with calendars)
    const sameTypeDroppables = droppables.filter(
      (d) => isAccountId(d.id as string) === isAccount
    );

    // Find a droppable whose trigger zone contains our center
    return findDroppableInTriggerZone(
      sameTypeDroppables,
      draggable.id,
      draggableCenter
    );
  };
}

/**
 * Find a droppable whose trigger zone contains the draggable's center.
 * Trigger zones are the top/bottom TRIGGER_ZONE_PERCENT of each item.
 * Returns null if we're in any item's dead zone (the middle portion).
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
