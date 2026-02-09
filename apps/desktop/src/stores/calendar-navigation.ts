import { createSignal, createMemo } from "solid-js";
import { currentView } from "./view";

// Helper to create stable date key for <Key> component
export const getDateKey = (date: Date): string =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

// Helper to check if a date is a week start (Sunday)
export const isWeekStart = (date: Date): boolean => date.getDay() === 0;

// Initial Reference Date (Anchor)
// All positions are calculated relative to this date being at CENTER_OFFSET
// This is now a signal so we can re-anchor when navigating far from current position
export const getInitialAnchor = () => {
  const today = new Date();
  const d = new Date(today);
  d.setDate(today.getDate() - today.getDay()); // Start with Sunday
  d.setHours(0, 0, 0, 0);
  return d;
};

export const [anchorDate, setAnchorDate] = createSignal(getInitialAnchor());

// Export signals for external control
// Initialize to anchor (Sunday of current week) for consistent startup
export const [centerDate, setCenterDate] = createSignal(
  new Date(getInitialAnchor()),
);
// Flash highlight signal - set this to a date to trigger a flash animation on that day column
export const [flashDate, setFlashDate] = createSignal<Date | null>(null);
// The actual first visible day based on scroll position (updates with daily granularity)
export const [visibleStartDate, setVisibleStartDate] = createSignal(
  new Date(getInitialAnchor()),
);
// Visible weeks signal - contains 1-2 week IDs depending on whether view spans week boundary
export const [visibleWeeks, setVisibleWeeks] = createSignal<string[]>([]);
// Month view visible weeks - contains ~6 week IDs for the visible area in month view
export const [monthVisibleWeekIds, setMonthVisibleWeekIds] = createSignal<
  string[]
>([]);
// Scroll direction signal for prefetching - null when idle, 'left' (past) or 'right' (future)
export const [scrollDirection, setScrollDirection] = createSignal<
  "left" | "right" | null
>(null);

// Navigation target signal - set this SYNCHRONOUSLY before changing visibleDaysCount
// to ensure the visibleDaysCount effect uses the correct target date.
// This avoids race conditions with deferred effects.
export const [navigationTarget, setNavigationTarget] = createSignal<Date | null>(null);

// Active visible weeks - switches between week view and month view based on currentView
// This is the signal that the events store should react to
export const activeVisibleWeeks = createMemo(() => {
  if (currentView() === "Month") {
    return monthVisibleWeekIds();
  }
  return visibleWeeks();
});
