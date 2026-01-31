const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;

/**
 * Get ISO week ID for a date (e.g., "2025-W05")
 * Uses ISO 8601 week numbering (week 1 contains first Thursday of year)
 */
export function getWeekId(date: Date): string {
  // Get Thursday of this week (ISO week is defined by its Thursday)
  const thursday = new Date(date);
  thursday.setDate(date.getDate() - ((date.getDay() + 6) % 7) + 3);

  // Get January 1st of the Thursday's year
  const jan1 = new Date(thursday.getFullYear(), 0, 1);

  // Calculate week number
  const dayOfYear = Math.floor(
    (thursday.getTime() - jan1.getTime()) / MS_PER_DAY
  );
  const weekNum = Math.floor(dayOfYear / DAYS_PER_WEEK) + 1;

  return `${thursday.getFullYear()}-W${weekNum.toString().padStart(2, "0")}`;
}

/**
 * Get all week IDs that overlap with a date range
 * Iterates day-by-day because ISO weeks (Mon-Sun) don't align perfectly
 * with calendar weeks, making skip-by-7 unreliable
 */
export function getWeeksInRange(start: Date, end: Date): string[] {
  const weeks: string[] = [];
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);

  const endTime = end.getTime();

  while (current.getTime() <= endTime) {
    const weekId = getWeekId(current);
    if (weeks.length === 0 || weeks[weeks.length - 1] !== weekId) {
      weeks.push(weekId);
    }
    current.setDate(current.getDate() + 1);
  }

  return weeks;
}

/**
 * Get the start and end dates for a week ID
 * Returns Monday 00:00:00 to Sunday 23:59:59.999 (UTC)
 */
export function getWeekBounds(weekId: string): { start: Date; end: Date } {
  // Parse week ID (e.g., "2025-W05")
  const match = weekId.match(/^(\d{4})-W(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid week ID format: ${weekId}`);
  }

  const year = parseInt(match[1], 10);
  const week = parseInt(match[2], 10);

  // Find January 4th of the year (always in week 1 by ISO standard)
  const jan4 = new Date(Date.UTC(year, 0, 4));

  // Find the Monday of week 1
  const dayOfWeek = jan4.getUTCDay();
  const mondayOfWeek1 = new Date(jan4);
  mondayOfWeek1.setUTCDate(jan4.getUTCDate() - ((dayOfWeek + 6) % 7));

  // Calculate the Monday of the target week
  const targetMonday = new Date(mondayOfWeek1);
  targetMonday.setUTCDate(mondayOfWeek1.getUTCDate() + (week - 1) * 7);
  targetMonday.setUTCHours(0, 0, 0, 0);

  // Get Sunday (end of week)
  const targetSunday = new Date(targetMonday);
  targetSunday.setUTCDate(targetMonday.getUTCDate() + 6);
  targetSunday.setUTCHours(23, 59, 59, 999);

  return { start: targetMonday, end: targetSunday };
}

/**
 * Get consolidated date bounds for multiple week IDs
 * Returns the earliest start and latest end across all weeks
 */
export function getDateBoundsForWeeks(
  weekIds: string[]
): { start: Date; end: Date } {
  if (weekIds.length === 0) {
    throw new Error("Cannot get bounds for empty week list");
  }

  let minStart: Date | null = null;
  let maxEnd: Date | null = null;

  for (const weekId of weekIds) {
    const { start, end } = getWeekBounds(weekId);
    if (!minStart || start < minStart) {
      minStart = start;
    }
    if (!maxEnd || end > maxEnd) {
      maxEnd = end;
    }
  }

  return { start: minStart!, end: maxEnd! };
}
