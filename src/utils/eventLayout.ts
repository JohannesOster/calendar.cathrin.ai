import type { CalendarEvent } from "../stores/events";

// Threshold for "same start time" - events starting within this many minutes are considered simultaneous
// Notion uses ~30 minutes - if events start closer than this, they get separate columns
const SAME_START_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

// Cascade indent for staggered events (percentage points)
const CASCADE_INDENT_PERCENT = 5;

export interface EventLayoutInfo {
  left: string;
  width: string;
  zIndex: number;
}

/**
 * Check if two events overlap in time
 */
function eventsOverlap(a: CalendarEvent, b: CalendarEvent): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Build clusters of overlapping events (connected components)
 */
function buildClusters(events: CalendarEvent[]): CalendarEvent[][] {
  if (events.length === 0) return [];

  const visited = new Set<string>();
  const clusters: CalendarEvent[][] = [];

  function dfs(event: CalendarEvent, cluster: CalendarEvent[]) {
    if (visited.has(event.id)) return;
    visited.add(event.id);
    cluster.push(event);

    for (const other of events) {
      if (!visited.has(other.id) && eventsOverlap(event, other)) {
        dfs(other, cluster);
      }
    }
  }

  for (const event of events) {
    if (!visited.has(event.id)) {
      const cluster: CalendarEvent[] = [];
      dfs(event, cluster);
      cluster.sort((a, b) => a.start.getTime() - b.start.getTime());
      clusters.push(cluster);
    }
  }

  return clusters;
}

/**
 * Layout a cluster using Notion Calendar's actual algorithm:
 * - Events starting at same time define columns
 * - Later events cascade on top of rightmost overlapping column
 * - Column 0 events: reduced width to show space for overlapping events
 * - Later column events: fill to 100% from their left position
 */
function layoutCluster(cluster: CalendarEvent[]): Map<string, EventLayoutInfo> {
  const layouts = new Map<string, EventLayoutInfo>();

  if (cluster.length === 1) {
    layouts.set(cluster[0].id, {
      left: "4px",
      width: "calc(100% - 8px)",
      zIndex: 1,
    });
    return layouts;
  }

  // Sort by start time, then by duration (longer first)
  const sorted = [...cluster].sort((a, b) => {
    const startDiff = a.start.getTime() - b.start.getTime();
    if (startDiff !== 0) return startDiff;
    return b.end.getTime() - a.end.getTime();
  });

  // Identify base events (earliest starters) and cascade events
  const baseEvents: CalendarEvent[] = [];
  const cascadeEvents: CalendarEvent[] = [];
  const earliestStart = sorted[0].start.getTime();

  for (const event of sorted) {
    if (event.start.getTime() - earliestStart <= SAME_START_THRESHOLD_MS) {
      baseEvents.push(event);
    } else {
      cascadeEvents.push(event);
    }
  }

  // Assign columns to base events
  const columnAssignments = new Map<string, number>();
  const numBaseColumns = baseEvents.length;

  for (let i = 0; i < baseEvents.length; i++) {
    columnAssignments.set(baseEvents[i].id, i);
  }

  // Assign cascade events to the rightmost column they overlap with
  for (const event of cascadeEvents) {
    let bestColumn = 0;
    for (const baseEvent of baseEvents) {
      if (eventsOverlap(event, baseEvent)) {
        const col = columnAssignments.get(baseEvent.id)!;
        if (col >= bestColumn) bestColumn = col;
      }
    }
    for (const other of cascadeEvents) {
      if (other.id !== event.id && eventsOverlap(event, other) && columnAssignments.has(other.id)) {
        const col = columnAssignments.get(other.id)!;
        if (col >= bestColumn) bestColumn = col;
      }
    }
    columnAssignments.set(event.id, bestColumn);
  }

  // Calculate cascade levels within each column
  const cascadeLevels = new Map<string, number>();
  for (const event of baseEvents) {
    cascadeLevels.set(event.id, 0);
  }

  cascadeEvents.sort((a, b) => a.start.getTime() - b.start.getTime());

  for (const event of cascadeEvents) {
    const column = columnAssignments.get(event.id)!;
    let level = 0;
    for (const other of [...baseEvents, ...cascadeEvents]) {
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

  // Calculate max concurrent events (for width calculation)
  // This includes cascade events as additional "layers"
  const maxCascadeLevel = Math.max(0, ...Array.from(cascadeLevels.values()));
  const totalLayers = numBaseColumns + maxCascadeLevel;

  // Calculate layouts using Notion's formula:
  // - columnWidth = 100 / totalLayers
  // - Column 0: width = 100 - (columnWidth / 2) to leave room
  // - Other columns: fill to 100% from left position
  const columnWidth = 100 / totalLayers;

  for (let i = 0; i < sorted.length; i++) {
    const event = sorted[i];
    const column = columnAssignments.get(event.id)!;
    const cascadeLevel = cascadeLevels.get(event.id) ?? 0;

    // Calculate left position
    const baseLeft = column * columnWidth;
    const cascadeIndent = cascadeLevel * CASCADE_INDENT_PERCENT;
    const left = baseLeft + cascadeIndent;

    // Calculate width
    let width: number;
    if (column === 0 && cascadeLevel === 0) {
      // First column base event: reduced width to show overlapping events
      width = 100 - columnWidth / 2;
    } else {
      // All other events: fill to 100% from left position
      width = 100 - left;
    }

    layouts.set(event.id, {
      left: `calc(${left}% + 4px)`,
      width: `calc(${width}% - 8px)`,
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

  const sorted = [...events].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );

  const clusters = buildClusters(sorted);

  for (const cluster of clusters) {
    const clusterLayouts = layoutCluster(cluster);
    for (const [id, layout] of clusterLayouts) {
      allLayouts.set(id, layout);
    }
  }

  return allLayouts;
}
