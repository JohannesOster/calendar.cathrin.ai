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
