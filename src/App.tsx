import { onMount } from "solid-js";
import "./App.css";
import { AppShell } from "./components/layout/AppShell";
import { CalendarHeader } from "./components/layout/CalendarHeader";
import { LeftSidebar } from "./components/layout/LeftSidebar";
import { CalendarGrid } from "./components/calendar/CalendarGrid";
import { initializeAccounts } from "./stores/accounts";

function App() {
  onMount(() => {
    initializeAccounts();
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
