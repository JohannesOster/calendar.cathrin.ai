import type { CalendarEvent } from "../stores/events";

/**
 * Layout information for positioning an all-day event chip
 */
export interface AllDayLayoutInfo {
  row: number; // Which row (0, 1, 2, ...)
  startCol: number; // Starting column index (0-6 for week)
  span: number; // Number of columns to span
  startsBeforeView: boolean; // Event starts before visible range
  endsAfterView: boolean; // Event ends after visible range
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Get days between two dates (floor division)
 */
function daysBetween(from: Date, to: Date): number {
  const fromMidnight = new Date(from);
  fromMidnight.setHours(0, 0, 0, 0);
  const toMidnight = new Date(to);
  toMidnight.setHours(0, 0, 0, 0);
  return Math.floor((toMidnight.getTime() - fromMidnight.getTime()) / MS_PER_DAY);
}

/**
 * Sort comparator: by start date ASC, then by duration DESC (longer first)
 * Longer events first ensures consistent row placement across scrolling
 */
function compareAllDayEvents(a: CalendarEvent, b: CalendarEvent): number {
  const startDiff = a.start.getTime() - b.start.getTime();
  if (startDiff !== 0) return startDiff;
  // Same start: longer events first
  const aDuration = a.end.getTime() - a.start.getTime();
  const bDuration = b.end.getTime() - b.start.getTime();
  return bDuration - aDuration;
}

/**
 * Check if two column ranges overlap
 */
function columnsOverlap(
  a: { startCol: number; span: number },
  b: { startCol: number; span: number }
): boolean {
  const aEnd = a.startCol + a.span - 1;
  const bEnd = b.startCol + b.span - 1;
  return a.startCol <= bEnd && b.startCol <= aEnd;
}

/**
 * Check if an event overlaps the view range
 * All-day events use exclusive end (event on Jan 15 has end of Jan 16 00:00)
 */
function eventOverlapsView(
  event: CalendarEvent,
  viewStart: Date,
  viewEnd: Date
): boolean {
  // viewEnd is inclusive (the last visible day)
  // event.end is exclusive (midnight of day after last event day)
  const viewEndExclusive = new Date(viewEnd);
  viewEndExclusive.setDate(viewEndExclusive.getDate() + 1);
  viewEndExclusive.setHours(0, 0, 0, 0);

  return event.start < viewEndExclusive && event.end > viewStart;
}

/**
 * Calculate layout info for all-day events within a view range
 *
 * @param events - All calendar events (will filter to all-day)
 * @param viewStart - First visible day (e.g., Sunday)
 * @param viewEnd - Last visible day (e.g., Saturday)
 * @returns Map of event ID to layout info
 */
export function calculateAllDayLayouts(
  events: CalendarEvent[],
  viewStart: Date,
  viewEnd: Date
): Map<string, AllDayLayoutInfo> {
  const layouts = new Map<string, AllDayLayoutInfo>();

  // Normalize dates to midnight
  const viewStartNorm = new Date(viewStart);
  viewStartNorm.setHours(0, 0, 0, 0);
  const viewEndNorm = new Date(viewEnd);
  viewEndNorm.setHours(0, 0, 0, 0);

  // Filter to all-day events that overlap the view
  const allDayEvents = events.filter(
    (e) => e.isAllDay && eventOverlapsView(e, viewStartNorm, viewEndNorm)
  );

  if (allDayEvents.length === 0) return layouts;

  // Sort by start date, then duration (longer first)
  const sorted = [...allDayEvents].sort(compareAllDayEvents);

  // Track which columns are occupied in each row
  // rows[rowIndex] = array of { startCol, span } for events in that row
  const rows: Array<Array<{ startCol: number; span: number }>> = [];

  for (const event of sorted) {
    // Calculate column span for this event
    // startCol: days from viewStart to event.start (min 0)
    const rawStartCol = daysBetween(viewStartNorm, event.start);
    const startCol = Math.max(0, rawStartCol);

    // For all-day events, end is exclusive (midnight of next day)
    // So the last visible day of the event is (end - 1 day)
    const eventLastDay = new Date(event.end);
    eventLastDay.setDate(eventLastDay.getDate() - 1);
    eventLastDay.setHours(0, 0, 0, 0);

    // endCol: days from viewStart to event's last day (max 6)
    const rawEndCol = daysBetween(viewStartNorm, eventLastDay);
    const endCol = Math.min(6, rawEndCol);

    // Span is the number of columns (1 = single day)
    const span = endCol - startCol + 1;

    // Skip if event has no visible span (shouldn't happen after filtering)
    if (span <= 0) continue;

    const eventSpan = { startCol, span };

    // Find first row without conflict
    let assignedRow = 0;
    while (assignedRow < rows.length) {
      const rowOccupied = rows[assignedRow].some((occupied) =>
        columnsOverlap(eventSpan, occupied)
      );
      if (!rowOccupied) break;
      assignedRow++;
    }

    // Add to row (create if needed)
    if (assignedRow >= rows.length) {
      rows.push([]);
    }
    rows[assignedRow].push(eventSpan);

    // Determine if event extends beyond view
    const startsBeforeView = event.start < viewStartNorm;
    const viewEndNextDay = new Date(viewEndNorm);
    viewEndNextDay.setDate(viewEndNextDay.getDate() + 1);
    viewEndNextDay.setHours(0, 0, 0, 0);
    const endsAfterView = event.end > viewEndNextDay;

    layouts.set(event.id, {
      row: assignedRow,
      startCol,
      span,
      startsBeforeView,
      endsAfterView,
    });
  }

  return layouts;
}

/**
 * Get the total number of rows needed for all-day events
 */
export function getAllDayRowCount(layouts: Map<string, AllDayLayoutInfo>): number {
  if (layouts.size === 0) return 0;
  let maxRow = 0;
  for (const layout of layouts.values()) {
    if (layout.row > maxRow) maxRow = layout.row;
  }
  return maxRow + 1;
}
