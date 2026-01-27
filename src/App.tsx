import { onMount, onCleanup, createEffect, on } from "solid-js";
import "./App.css";
import { AppShell } from "./components/layout/AppShell";
import { CalendarHeader } from "./components/layout/CalendarHeader";
import { LeftSidebar } from "./components/layout/LeftSidebar";
import { CalendarGrid, visibleWeeks } from "./components/calendar/CalendarGrid";
import { initializeAccounts } from "./stores/accounts";
import {
  initializeEvents,
  getEventsForRange,
  fetchEventsForWeek,
  getWeekBounds,
} from "./stores/events";

// Debounce delay for fetch trigger (ms)
const FETCH_DEBOUNCE_MS = 500;

function App() {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(async () => {
    await initializeAccounts();
    initializeEvents();
  });

  // Cleanup debounce timer on unmount
  onCleanup(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
  });

  // Watch visible weeks and trigger fetches for missing weeks
  createEffect(
    on(visibleWeeks, (weeks) => {
      if (weeks.length === 0) return;

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

          // Fetch each missing week
          for (const week of missingWeeks) {
            fetchEventsForWeek(week);
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
