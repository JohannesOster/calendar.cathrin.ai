import { addDays } from "../../../lib/date-utils";

// ============================================================================
// Constants - Grid Dimensions
// ============================================================================
export const WEEK_ROW_HEIGHT = 120; // px per week row
export const WEEKDAY_HEADER_HEIGHT = 32; // px for Sun-Sat header
export const VISIBLE_BUFFER_WEEKS = 3; // Extra weeks to render off-screen

// ============================================================================
// Constants - Virtual Scroll Container
// ============================================================================
export const CONTAINER_HEIGHT = 500000; // Large virtual height for infinite scroll
export const CENTER_OFFSET = CONTAINER_HEIGHT / 2; // Anchor point in middle

// ============================================================================
// Constants - Snap Track
// ============================================================================
export const SNAP_TRACK_WEEKS = 260; // ~5 years in each direction (52 weeks/year)

// Anchor date - Sunday of current week (same as week view)
export const anchorDate = (() => {
  const today = new Date();
  const d = new Date(today);
  d.setDate(today.getDate() - today.getDay()); // Start with Sunday
  d.setHours(0, 0, 0, 0);
  console.log('[MonthView] anchorDate:', d.toISOString());
  return d;
})();

// Helper to get week index from date (relative to anchor)
export const getWeekIndex = (date: Date): number => {
  const normalizedDate = new Date(date);
  normalizedDate.setHours(0, 0, 0, 0);
  const diffTime = normalizedDate.getTime() - anchorDate.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7);
};

// Helper to get Sunday of a week by index
export const getWeekStartDate = (weekIndex: number): Date => {
  return addDays(anchorDate, weekIndex * 7);
};

// Helper to check if a week is the first week of a month
export const isFirstWeekOfMonth = (weekStartDate: Date): boolean => {
  // Check if any day in this week is the 1st of a month
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStartDate, i);
    if (day.getDate() === 1) return true;
  }
  return false;
};

// Helper to get month label for a week (if it's the first week)
export const getMonthLabel = (weekStartDate: Date): string | null => {
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStartDate, i);
    if (day.getDate() === 1) {
      const month = day.toLocaleDateString("en-US", { month: "long" });
      const year = day.getFullYear();
      return `${month} ${year}`;
    }
  }
  return null;
};

// Get stable key for a week
export const getWeekKey = (weekIndex: number): string => `week-${weekIndex}`;
