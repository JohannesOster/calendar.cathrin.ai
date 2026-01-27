/**
 * Get the Sunday (start of week) for any given date
 * Always normalized to midnight to avoid time-based calculation issues
 */
export function getSundayOfWeek(date: Date): Date {
  const result = new Date(date);
  result.setDate(date.getDate() - date.getDay());
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Check if two dates are the same day (ignoring time)
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getDate() === date2.getDate() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getFullYear() === date2.getFullYear()
  );
}

/**
 * Check if a date is today
 */
export function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

/**
 * Add (or subtract) days from a date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Format a date as "Month Year" (e.g., "January 2024")
 */
export function formatMonthYear(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * Format a date as "Month Year" for mini calendar display (uses default locale)
 */
export function formatMonthYearLocale(date: Date): string {
  return date.toLocaleString("default", { month: "long", year: "numeric" });
}

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
    (thursday.getTime() - jan1.getTime()) / (24 * 60 * 60 * 1000)
  );
  const weekNum = Math.floor(dayOfYear / 7) + 1;

  return `${thursday.getFullYear()}-W${weekNum.toString().padStart(2, "0")}`;
}

/**
 * Get the start and end dates for a week ID
 * Returns Sunday 00:00:00 to Saturday 23:59:59.999 (local time)
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
  const jan4 = new Date(year, 0, 4);
  jan4.setHours(0, 0, 0, 0);

  // Find the Monday of week 1
  const dayOfWeek = jan4.getDay();
  const mondayOfWeek1 = new Date(jan4);
  mondayOfWeek1.setDate(jan4.getDate() - ((dayOfWeek + 6) % 7));

  // Calculate the Monday of the target week
  const targetMonday = new Date(mondayOfWeek1);
  targetMonday.setDate(mondayOfWeek1.getDate() + (week - 1) * 7);

  // Get Sunday before this Monday (start of week for our calendar)
  const sunday = new Date(targetMonday);
  sunday.setDate(targetMonday.getDate() - 1);
  sunday.setHours(0, 0, 0, 0);

  // Get Saturday (end of week)
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);
  saturday.setHours(23, 59, 59, 999);

  return { start: sunday, end: saturday };
}

/**
 * Get all week IDs that overlap with a date range
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
