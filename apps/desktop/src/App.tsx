import { onMount, onCleanup, createEffect, on } from "solid-js";
import "./App.css";
import { AppShell } from "./components/layout/AppShell";
import { CalendarHeader } from "./components/layout/CalendarHeader";
import { LeftSidebar } from "./components/layout/LeftSidebar";
import { CalendarGrid, activeVisibleWeeks, scrollDirection } from "./components/calendar/CalendarGrid";
import { initAuth } from "./stores/auth";
import { initializeAccounts } from "./stores/accounts";
import {
  initializeEvents,
  getEventsForRange,
  fetchEventsForWeek,
  getWeekBounds,
  updateVisibleWeeks,
  getFetchedWeeks,
  getFetchingWeeks,
  startPolling,
  stopPolling,
  handleVisibilityChange,
} from "./stores/events";
import { getNextWeek, getPreviousWeek } from "./lib/date-utils";

// Debounce delay for fetch trigger (ms)
const FETCH_DEBOUNCE_MS = 100;

function App() {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  // Handle Cmd+R / Ctrl+R for full app reload
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "r") {
      e.preventDefault();
      window.location.reload();
    }
  };

  onMount(async () => {
    // Initialize auth first to load session token
    await initAuth();
    // Then load accounts and events (both check isAuthenticated)
    await initializeAccounts();
    await initializeEvents();

    // Start polling for visible week updates
    startPolling();

    // Listen for visibility changes to pause/resume polling
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Listen for Cmd+R to manually refresh
    document.addEventListener("keydown", handleKeyDown);
  });

  // Cleanup on unmount
  onCleanup(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    stopPolling();
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    document.removeEventListener("keydown", handleKeyDown);
  });

  // Watch visible weeks and trigger fetches for missing weeks
  // Uses activeVisibleWeeks which switches between week view (1-2 weeks) and month view (~6 weeks)
  createEffect(
    on(activeVisibleWeeks, (weeks) => {
      console.log('[activeVisibleWeeks] Changed:', weeks);
      if (weeks.length === 0) return;

      // Update visible weeks immediately (triggers cancellation of non-visible fetches)
      updateVisibleWeeks(weeks);

      // Clear any pending debounce
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      // Debounce the fetch trigger
      debounceTimer = setTimeout(() => {
        // Calculate the date range from visible weeks
        const firstWeek = weeks[0];
        const lastWeek = weeks[weeks.length - 1];
        const rangeStart = getWeekBounds(firstWeek).start;
        const rangeEnd = getWeekBounds(lastWeek).end;

        // Check which weeks are missing
        const { missingWeeks } = getEventsForRange(rangeStart, rangeEnd);

        if (missingWeeks.length > 0) {
          console.log(`[progressive-load] Fetching missing weeks:`, missingWeeks);

          // Fetch all missing weeks in parallel
          Promise.all(missingWeeks.map(week => fetchEventsForWeek(week)));
        }

        // Directional prefetching: fetch next week in scroll direction
        const direction = scrollDirection();
        if (direction) {
          const targetWeek = direction === 'right'
            ? getNextWeek(lastWeek)    // Prefetch week after visible range
            : getPreviousWeek(firstWeek); // Prefetch week before visible range

          const cached = getFetchedWeeks();
          const fetching = getFetchingWeeks();

          // Only prefetch if not already cached or being fetched
          if (!cached.has(targetWeek) && !fetching.has(targetWeek)) {
            console.log(`[prefetch] Prefetching ${targetWeek} (direction: ${direction})`);
            fetchEventsForWeek(targetWeek);
          }
        }
      }, FETCH_DEBOUNCE_MS);
    })
  );

  return (
    <AppShell
      header={<CalendarHeader />}
      leftSidebar={<LeftSidebar />}
    >
      <CalendarGrid />
    </AppShell>
  );
}

export default App;
