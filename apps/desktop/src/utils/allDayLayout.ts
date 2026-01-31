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
 * Get the date components (year, month, day) in UTC
 * This avoids timezone issues with date-only strings
 */
function getUTCDateOnly(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Get days between two dates using UTC to avoid timezone issues
 * This is important for all-day events which use date-only strings
 */
function daysBetween(from: Date, to: Date): number {
  const fromUTC = getUTCDateOnly(from);
  const toUTC = getUTCDateOnly(to);
  return Math.round((toUTC - fromUTC) / MS_PER_DAY);
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
 * Uses UTC comparison to avoid timezone issues
 */
function eventOverlapsView(
  event: CalendarEvent,
  viewStart: Date,
  viewEnd: Date
): boolean {
  // Compare using UTC date components to avoid timezone issues
  const eventStartUTC = getUTCDateOnly(event.start);
  const eventEndUTC = getUTCDateOnly(event.end);
  const viewStartUTC = getUTCDateOnly(viewStart);
  // viewEnd is inclusive, so add 1 day for exclusive comparison
  const viewEndExclusiveUTC = getUTCDateOnly(viewEnd) + MS_PER_DAY;

  return eventStartUTC < viewEndExclusiveUTC && eventEndUTC > viewStartUTC;
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

  // Use UTC date components for consistent comparison
  // (avoids timezone issues with date-only strings from API)
  const viewStartNorm = new Date(getUTCDateOnly(viewStart));
  const viewEndNorm = new Date(getUTCDateOnly(viewEnd));

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
    // For all-day events, end is exclusive (midnight of next day)
    // So event duration in days = daysBetween(start, end)
    const eventDurationDays = daysBetween(event.start, event.end);

    // Calculate event position relative to view
    const eventStartOffset = daysBetween(viewStartNorm, event.start);

    // startCol: where the event starts in the view (min 0)
    const startCol = Math.max(0, eventStartOffset);

    // endCol: where the event ends in the view (max 6)
    // The event's last day is at offset: eventStartOffset + eventDurationDays - 1
    const eventEndOffset = eventStartOffset + eventDurationDays - 1;
    const endCol = Math.min(6, eventEndOffset);

    // Span is the visible portion of the event
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

    // Determine if event extends beyond view (using UTC comparison)
    const eventStartUTC = getUTCDateOnly(event.start);
    const eventEndUTC = getUTCDateOnly(event.end);
    const viewStartUTC = getUTCDateOnly(viewStartNorm);
    const viewEndNextDayUTC = getUTCDateOnly(viewEndNorm) + MS_PER_DAY;
    const startsBeforeView = eventStartUTC < viewStartUTC;
    const endsAfterView = eventEndUTC > viewEndNextDayUTC;

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
