import { onMount } from "solid-js";
import "./App.css";
import { AppShell } from "./components/layout/AppShell";
import { CalendarHeader } from "./components/layout/CalendarHeader";
import { LeftSidebar } from "./components/layout/LeftSidebar";
import { CalendarGrid } from "./components/calendar/CalendarGrid";
import { initializeAccounts } from "./stores/accounts";
import { initializeEvents } from "./stores/events";

function App() {
  onMount(async () => {
    await initializeAccounts();
    initializeEvents();
  });

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
