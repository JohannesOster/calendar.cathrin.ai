import { onMount, onCleanup, createEffect, on, Show } from "solid-js";
import "./App.css";
import { AppShell, setRightSidebarOpen } from "./components/layout/AppShell";
import { CalendarHeader } from "./components/layout/CalendarHeader";
import { LeftSidebar } from "./components/layout/LeftSidebar";
import { EventForm } from "./components/sidebar/EventForm";
import { isCreating, isDragging } from "./stores/event-creation";
import { selectedEventId, deselectEvent } from "./stores/event-selection";
import { CalendarGrid, activeVisibleWeeks, scrollDirection } from "./components/calendar/CalendarGrid";
import { UndoToastProvider } from "./components/ui/UndoToast";
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
  handleOnline,
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

    // Revalidate when network comes back online
    window.addEventListener("online", handleOnline);

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
    window.removeEventListener("online", handleOnline);
    document.removeEventListener("keydown", handleKeyDown);
  });

  // Open right sidebar when event creation starts, but wait until drag finishes
  // so the sidebar doesn't resize columns mid-drag causing unintended multi-day selection
  createEffect(() => {
    if (isCreating() && !isDragging()) {
      setRightSidebarOpen(true);
    }
  });

  // Watch visible weeks and trigger fetches for missing weeks
  // Uses activeVisibleWeeks which switches between week view (1-2 weeks) and month view (~6 weeks)
  createEffect(
    on(activeVisibleWeeks, (weeks) => {
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
            fetchEventsForWeek(targetWeek);
          }
        }
      }, FETCH_DEBOUNCE_MS);
    })
  );

  return (
    <>
      <UndoToastProvider />
      <AppShell
        header={<CalendarHeader />}
        leftSidebar={<LeftSidebar />}
        rightSidebar={
          <Show when={isCreating() || selectedEventId()}>
            <EventForm />
          </Show>
        }
      >
        <CalendarGrid />
      </AppShell>
    </>
  );
}

export default App;
