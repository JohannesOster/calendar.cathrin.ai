import { createSignal, createEffect } from "solid-js";
import { STORAGE_KEYS } from "../constants/storage-keys";

export type ViewType = "Day" | "Week" | "Month";

const VALID_VIEWS: ReadonlySet<string> = new Set<ViewType>(["Day", "Week", "Month"]);

// View state - controls which calendar view is displayed
export const [currentView, setCurrentView] = createSignal<ViewType>("Week");

// Visible days count - number of day columns visible in the calendar grid
// Default is 7 (week view), range is 1-14
const DEFAULT_VISIBLE_DAYS = 7;
const MIN_VISIBLE_DAYS = 1;
const MAX_VISIBLE_DAYS = 14;
const STORAGE_KEY = "visibleDaysCount";

export const [visibleDaysCount, setVisibleDaysCountInternal] =
  createSignal(DEFAULT_VISIBLE_DAYS);

// Setter with bounds validation
export function setVisibleDaysCount(value: number) {
  const clamped = Math.max(MIN_VISIBLE_DAYS, Math.min(MAX_VISIBLE_DAYS, value));
  setVisibleDaysCountInternal(clamped);
}

// Initialize currentView from localStorage
export function initCurrentView() {
  const saved = localStorage.getItem(STORAGE_KEYS.CURRENT_VIEW);
  if (saved !== null && VALID_VIEWS.has(saved)) {
    setCurrentView(saved as ViewType);
  }
}

// Persist currentView to localStorage - call this from a component that can use createEffect
export function createCurrentViewPersistence() {
  createEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CURRENT_VIEW, currentView());
  });
}

// Initialize from localStorage
export function initVisibleDaysCount() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved !== null) {
    const parsed = parseInt(saved, 10);
    if (!isNaN(parsed) && parsed >= MIN_VISIBLE_DAYS && parsed <= MAX_VISIBLE_DAYS) {
      setVisibleDaysCountInternal(parsed);
    }
  }
}

// Persist to localStorage - call this from a component that can use createEffect
export function createVisibleDaysPersistence() {
  createEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(visibleDaysCount()));
  });
}
