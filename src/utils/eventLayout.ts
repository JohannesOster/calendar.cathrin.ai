import type { CalendarEvent } from "../stores/events";
import {
  SAME_START_THRESHOLD_MS,
  CASCADE_INDENT_PERCENT,
  EVENT_MARGIN_X_PX,
  EVENT_MARGIN_TOTAL_PX,
} from "../constants/calendar";

export interface EventLayoutInfo {
  left: string;
  width: string;
  zIndex: number;
}

/**
 * Sort comparator for events: by start time, then by duration (longer first)
 */
function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  const startDiff = a.start.getTime() - b.start.getTime();
  if (startDiff !== 0) return startDiff;
  // Same start time: longer events first (they go behind shorter ones)
  return b.end.getTime() - a.end.getTime();
}

/**
 * Check if two events overlap in time
 */
function eventsOverlap(a: CalendarEvent, b: CalendarEvent): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Build clusters of overlapping events (connected components)
 * Input should already be sorted by compareEvents
 */
function buildClusters(sortedEvents: CalendarEvent[]): CalendarEvent[][] {
  if (sortedEvents.length === 0) return [];

  const visited = new Set<string>();
  const clusters: CalendarEvent[][] = [];

  function dfs(event: CalendarEvent, cluster: CalendarEvent[]) {
    if (visited.has(event.id)) return;
    visited.add(event.id);
    cluster.push(event);

    for (const other of sortedEvents) {
      if (!visited.has(other.id) && eventsOverlap(event, other)) {
        dfs(other, cluster);
      }
    }
  }

  for (const event of sortedEvents) {
    if (!visited.has(event.id)) {
      const cluster: CalendarEvent[] = [];
      dfs(event, cluster);
      // Cluster inherits sorted order from input, but DFS may add out of order
      // Re-sort to ensure correct order within cluster
      cluster.sort(compareEvents);
      clusters.push(cluster);
    }
  }

  return clusters;
}

/**
 * Layout a cluster using Notion Calendar's algorithm:
 * - Events starting within SAME_START_THRESHOLD define base columns
 * - Later events cascade on top of rightmost overlapping column
 * - Column 0 gets reduced width; others fill to 100%
 *
 * Input must be sorted by compareEvents
 */
function layoutCluster(sortedCluster: CalendarEvent[]): Map<string, EventLayoutInfo> {
  const layouts = new Map<string, EventLayoutInfo>();

  if (sortedCluster.length === 1) {
    layouts.set(sortedCluster[0].id, {
      left: `${EVENT_MARGIN_X_PX}px`,
      width: `calc(100% - ${EVENT_MARGIN_TOTAL_PX}px)`,
      zIndex: 1,
    });
    return layouts;
  }

  // Categorize into base events (simultaneous) and cascade events (later)
  const earliestStart = sortedCluster[0].start.getTime();
  const baseEvents: CalendarEvent[] = [];
  const cascadeEvents: CalendarEvent[] = [];

  for (const event of sortedCluster) {
    if (event.start.getTime() - earliestStart <= SAME_START_THRESHOLD_MS) {
      baseEvents.push(event);
    } else {
      cascadeEvents.push(event);
    }
  }

  // Assign columns to base events (they're already sorted)
  const columnAssignments = new Map<string, number>();
  for (let i = 0; i < baseEvents.length; i++) {
    columnAssignments.set(baseEvents[i].id, i);
  }

  // Assign cascade events to the rightmost column they overlap with
  // cascadeEvents maintain sorted order from sortedCluster
  for (const event of cascadeEvents) {
    let bestColumn = 0;

    // Check overlap with base events
    for (const baseEvent of baseEvents) {
      if (eventsOverlap(event, baseEvent)) {
        const col = columnAssignments.get(baseEvent.id)!;
        if (col >= bestColumn) bestColumn = col;
      }
    }

    // Check overlap with previously assigned cascade events
    for (const other of cascadeEvents) {
      if (other.id === event.id) break; // Only check events before this one
      if (eventsOverlap(event, other) && columnAssignments.has(other.id)) {
        const col = columnAssignments.get(other.id)!;
        if (col >= bestColumn) bestColumn = col;
      }
    }

    columnAssignments.set(event.id, bestColumn);
  }

  // Calculate cascade levels within each column
  const cascadeLevels = new Map<string, number>();

  // Base events are level 0
  for (const event of baseEvents) {
    cascadeLevels.set(event.id, 0);
  }

  // Cascade events get level based on how many earlier events they overlap in same column
  for (const event of cascadeEvents) {
    const column = columnAssignments.get(event.id)!;
    let level = 0;

    // Check all events in the same column that started before this one
    const allEvents = [...baseEvents, ...cascadeEvents];
    for (const other of allEvents) {
      if (other.id === event.id) continue;
      if (
        columnAssignments.get(other.id) === column &&
        eventsOverlap(event, other) &&
        other.start < event.start
      ) {
        const otherLevel = cascadeLevels.get(other.id) ?? 0;
        level = Math.max(level, otherLevel + 1);
      }
    }

    cascadeLevels.set(event.id, level);
  }

  // Calculate total layers for width distribution
  const maxCascadeLevel = Math.max(0, ...Array.from(cascadeLevels.values()));
  const totalLayers = baseEvents.length + maxCascadeLevel;
  const columnWidth = 100 / totalLayers;

  // Generate final layouts
  for (let i = 0; i < sortedCluster.length; i++) {
    const event = sortedCluster[i];
    const column = columnAssignments.get(event.id)!;
    const cascadeLevel = cascadeLevels.get(event.id) ?? 0;

    const baseLeft = column * columnWidth;
    const cascadeIndent = cascadeLevel * CASCADE_INDENT_PERCENT;
    const left = baseLeft + cascadeIndent;

    // Column 0 base event gets reduced width; others fill to edge
    const width = (column === 0 && cascadeLevel === 0)
      ? 100 - columnWidth / 2
      : 100 - left;

    layouts.set(event.id, {
      left: `calc(${left}% + ${EVENT_MARGIN_X_PX}px)`,
      width: `calc(${width}% - ${EVENT_MARGIN_TOTAL_PX}px)`,
      zIndex: i + 1,
    });
  }

  return layouts;
}

/**
 * Calculate layout info for all events in a day
 */
export function calculateEventLayouts(
  events: CalendarEvent[]
): Map<string, EventLayoutInfo> {
  const allLayouts = new Map<string, EventLayoutInfo>();

  if (events.length === 0) return allLayouts;

  // Sort once at the entry point
  const sorted = [...events].sort(compareEvents);

  // Build clusters and layout each
  const clusters = buildClusters(sorted);

  for (const cluster of clusters) {
    const clusterLayouts = layoutCluster(cluster);
    for (const [id, layout] of clusterLayouts) {
      allLayouts.set(id, layout);
    }
  }

  return allLayouts;
}
