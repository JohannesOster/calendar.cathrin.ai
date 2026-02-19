// Constants
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;

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
 * Get week ID for a date (e.g., "2025-W05")
 * Uses ISO 8601 week numbering but adjusted for Sunday-Saturday display.
 *
 * IMPORTANT: Our calendar displays Sunday-Saturday weeks, but ISO weeks are
 * Monday-Sunday. This means Sunday is the LAST day of an ISO week but the
 * FIRST day of our display week. We handle this by using Monday of our
 * display week for the ISO calculation.
 */
export function getWeekId(date: Date): string {
  // For our Sunday-Saturday weeks, use Monday of the same display week
  // to get the correct ISO week ID.
  // If date is Sunday (day 0), add 1 to get Monday of the same display week.
  // Otherwise, find the Monday of the current display week.
  const adjustedDate = new Date(date);
  const dayOfWeek = adjustedDate.getDay();
  if (dayOfWeek === 0) {
    // Sunday: move to Monday (next day) which is in the same display week
    adjustedDate.setDate(adjustedDate.getDate() + 1);
  }

  // Get Thursday of this ISO week (ISO week is defined by its Thursday)
  const thursday = new Date(adjustedDate);
  thursday.setDate(adjustedDate.getDate() - ((adjustedDate.getDay() + 6) % 7) + 3);

  // Calculate week number using UTC to avoid DST off-by-one errors.
  // Local timestamps can differ by ±1 hour across DST boundaries,
  // causing Math.floor to land on the wrong day.
  const thursdayUTC = Date.UTC(thursday.getFullYear(), thursday.getMonth(), thursday.getDate());
  const jan1UTC = Date.UTC(thursday.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((thursdayUTC - jan1UTC) / MS_PER_DAY);
  const weekNum = Math.floor(dayOfYear / DAYS_PER_WEEK) + 1;

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
 * Note: Uses day-by-day iteration because ISO weeks (Mon-Sun) don't align
 * with our calendar weeks (Sun-Sat), making skip-by-7 unreliable
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
 * Get the next week's ID
 * Note: Uses end of week + 2 days to land on Monday, avoiding the
 * ISO week boundary issue where Sunday is the last day of an ISO week
 */
export function getNextWeek(weekId: string): string {
  const { end } = getWeekBounds(weekId);
  // end is Saturday 23:59:59, add 2 days to reach Monday (definitely in next ISO week)
  const nextWeekMonday = addDays(end, 2);
  return getWeekId(nextWeekMonday);
}

/**
 * Get the previous week's ID (7 days backward)
 */
export function getPreviousWeek(weekId: string): string {
  const { start } = getWeekBounds(weekId);
  const prevWeekDate = addDays(start, -1);
  return getWeekId(prevWeekDate);
}

/**
 * Get the set of week IDs that fall within the "hot zone" (today ± specified days)
 * Hot zone weeks should never be evicted from cache
 */
export function getHotZoneWeeks(hotZoneDays: number = 30): Set<string> {
  const today = new Date();
  const start = addDays(today, -hotZoneDays);
  const end = addDays(today, hotZoneDays);
  return new Set(getWeeksInRange(start, end));
}

export interface MonthDayInfo {
  day: number;
  date: Date;
  isCurrentMonth: boolean;
}

/**
 * Compute 6 weeks of days for a month grid (Sun–Sat), including overflow from adjacent months.
 */
export function computeWeeksInMonth(date: Date): MonthDayInfo[][] {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startingDay = firstDay.getDay();

  const weeks: MonthDayInfo[][] = [];
  let currentWeek: MonthDayInfo[] = [];

  if (startingDay > 0) {
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startingDay - 1; i >= 0; i--) {
      const day = prevMonthLastDay - i;
      currentWeek.push({ day, date: new Date(year, month - 1, day), isCurrentMonth: false });
    }
  }

  for (let i = 1; i <= daysInMonth; i++) {
    currentWeek.push({ day: i, date: new Date(year, month, i), isCurrentMonth: true });
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  let nextMonthDay = 1;
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push({ day: nextMonthDay, date: new Date(year, month + 1, nextMonthDay), isCurrentMonth: false });
      nextMonthDay++;
    }
    weeks.push(currentWeek);
  }

  while (weeks.length < 6) {
    const extraWeek: MonthDayInfo[] = [];
    for (let i = 0; i < 7; i++) {
      extraWeek.push({ day: nextMonthDay, date: new Date(year, month + 1, nextMonthDay), isCurrentMonth: false });
      nextMonthDay++;
    }
    weeks.push(extraWeek);
  }

  return weeks;
}
