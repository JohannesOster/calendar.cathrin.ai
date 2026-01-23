import { createSignal, createEffect, JSX, onMount } from "solid-js";
import { PanelLeftClose, PanelLeft } from "lucide-solid";

interface AppShellProps {
  header: JSX.Element;
  leftSidebar: JSX.Element;
  rightSidebar?: JSX.Element;
  children: JSX.Element;
}

// Create signals for sidebar state (exported for use by other components)
export const [leftSidebarOpen, setLeftSidebarOpen] = createSignal(true);
export const [rightSidebarOpen, setRightSidebarOpen] = createSignal(true);

export function AppShell(props: AppShellProps) {
  // Initialize from localStorage on mount
  onMount(() => {
    const savedLeft = localStorage.getItem("leftSidebarOpen");
    const savedRight = localStorage.getItem("rightSidebarOpen");
    if (savedLeft !== null) setLeftSidebarOpen(savedLeft === "true");
    if (savedRight !== null) setRightSidebarOpen(savedRight === "true");
  });

  // Persist sidebar state to localStorage
  createEffect(() => {
    localStorage.setItem("leftSidebarOpen", String(leftSidebarOpen()));
  });

  createEffect(() => {
    localStorage.setItem("rightSidebarOpen", String(rightSidebarOpen()));
  });

  return (
    <div class="h-screen flex flex-col bg-white">
      {/* Header row - draggable, with integrated toggle button */}
      <div
        data-tauri-drag-region
        class="h-[var(--grid-header-height)] w-full shrink-0 flex items-center bg-[#fbfbfa] border-b border-[#e8e8e8] select-none"
      >
        {/* Toggle button - positioned to the right of traffic lights */}
        <div class="pl-20 pr-2">
          <button
            onClick={() => setLeftSidebarOpen((v) => !v)}
            class="p-1.5 rounded hover:bg-[#efefef] text-[#91918e] hover:text-[#37352f] transition-colors"
            title={leftSidebarOpen() ? "Hide sidebar" : "Show sidebar"}
          >
            {leftSidebarOpen() ? (
              <PanelLeftClose size={18} />
            ) : (
              <PanelLeft size={18} />
            )}
          </button>
        </div>

        {/* Header content - spans remaining width */}
        <div class="flex-1">{props.header}</div>
      </div>

      {/* Main layout - 3 column */}
      <div class="flex-1 flex min-w-0 relative overflow-x-hidden">
        {/* Left Sidebar - collapsible */}
        <aside
          class="sidebar shrink-0 border-r border-[#e8e8e8] bg-[#fbfbfa] relative z-10 overflow-hidden"
          classList={{
            "w-60": leftSidebarOpen(),
            "w-0 border-r-0": !leftSidebarOpen(),
          }}
        >
          <div class="sidebar-content h-full overflow-y-auto overflow-x-hidden w-60">
            {props.leftSidebar}
          </div>
        </aside>

        {/* Center content area */}
        <main class="flex-1 flex flex-col min-w-0 overflow-hidden bg-white">
          {/* Calendar grid */}
          <div class="flex-1 overflow-hidden min-w-0">{props.children}</div>
        </main>

        {/* Right Sidebar - collapsible */}
        <aside
          class="sidebar shrink-0 border-l border-[#e8e8e8] bg-[#fbfbfa] relative z-10 overflow-hidden"
          classList={{
            "w-60": rightSidebarOpen(),
            "w-0 border-l-0": !rightSidebarOpen(),
          }}
        >
          <div class="sidebar-content h-full overflow-y-auto overflow-x-hidden w-60">
            {props.rightSidebar}
          </div>
        </aside>
      </div>
    </div>
  );
}
