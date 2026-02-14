import { onMount, onCleanup, createEffect, on, Show } from "solid-js";
import "./App.css";
import { AppShell, setRightSidebarOpen } from "./components/layout/AppShell";
import { CalendarHeader } from "./components/layout/CalendarHeader";
import { LeftSidebar } from "./components/layout/LeftSidebar";
import { EventForm } from "./components/sidebar/EventForm";
import { EventDetailPanel } from "./components/sidebar/EventDetailPanel";
import { isCreating, isDragging } from "./stores/event-creation";
import { isDragActive } from "./stores/event-drag";
import { selectedEventId, selectedEvent } from "./stores/event-selection";
import { CalendarGrid } from "./components/calendar/CalendarGrid";
import { activeVisibleWeeks, scrollDirection } from "./stores/calendar-navigation";
import { UndoToastProvider } from "./components/ui/UndoToast";
import { DeleteConfirmDialog } from "./components/ui/DeleteConfirmDialog";
import { initAuth, isAuthenticated } from "./stores/auth";
import { initializeAccounts } from "./stores/accounts";
import {
  initializeEvents,
  getEventsForRange,
  fetchEventsForWeek,
  updateVisibleWeeks,
  getFetchedWeeks,
  getFetchingWeeks,
} from "./stores/event-fetching";
import {
  startPolling,
  stopPolling,
  handleVisibilityChange,
  handleOnline,
} from "./stores/event-polling";
import { connectWebSocket, disconnectWebSocket } from "./services/websocket";
import { getNextWeek, getPreviousWeek, getWeekBounds } from "./lib/date-utils";

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
    // Load session token (fast IPC) and set optimistic auth.
    // Validation runs in background — if invalid, apiFetch handles 401.
    await initAuth();
    // Load accounts and events in parallel (both check isAuthenticated)
    await Promise.all([initializeAccounts(), initializeEvents()]);

    // Start polling for visible week updates (fallback for WebSocket)
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
    disconnectWebSocket();
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

  // Weeks deferred during drag — deduplicated Set so repeated deferrals don't
  // cause duplicate fetches when the drag ends.
  const deferredWeeks = new Set<string>();

  // Watch visible weeks and trigger fetches for missing weeks.
  // Uses activeVisibleWeeks which switches between week view (1-2 weeks) and month view (~6 weeks).
  // During an active drag, fetches are deferred to avoid async responses overwriting
  // the drag-modified event data (see replaceEventsInRange guard for the safety net).
  createEffect(
    on(activeVisibleWeeks, (weeks) => {
      if (weeks.length === 0) return;

      // Update visible weeks immediately
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

        // During drag, defer fetches to prevent async responses from clobbering
        // drag state. The deferred Set deduplicates automatically.
        if (isDragActive()) {
          for (const week of missingWeeks) {
            deferredWeeks.add(week);
          }
          return;
        }

        if (missingWeeks.length > 0) {
          // Fetch all missing weeks in parallel
          Promise.all(missingWeeks.map(week => fetchEventsForWeek(week)))
            .catch((error) => console.error("[App] Failed to fetch missing weeks:", error));
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

  // Flush deferred fetches when drag ends
  createEffect(
    on(() => isDragActive(), (active, wasActive) => {
      if (wasActive && !active && deferredWeeks.size > 0) {
        const weeks = [...deferredWeeks];
        deferredWeeks.clear();
        Promise.all(weeks.map(week => fetchEventsForWeek(week)))
          .catch((error) => console.error("[App] Failed to fetch deferred weeks:", error));
      }
    }, { defer: true })
  );

  // Manage WebSocket lifecycle based on auth state
  createEffect(
    on(isAuthenticated, (authed) => {
      if (authed) {
        connectWebSocket();
      } else {
        disconnectWebSocket();
      }
    })
  );

  return (
    <>
      <UndoToastProvider />
      <DeleteConfirmDialog />
      <AppShell
        header={<CalendarHeader />}
        leftSidebar={<LeftSidebar />}
        rightSidebar={
          <Show when={isCreating() || selectedEventId()}>
            <Show
              when={selectedEvent()?.isReadOnly && selectedEvent()?.readOnlyReason !== "not_organizer"}
              fallback={<EventForm />}
            >
              <EventDetailPanel event={selectedEvent()!} />
            </Show>
          </Show>
        }
      >
        <CalendarGrid />
      </AppShell>
    </>
  );
}

export default App;
