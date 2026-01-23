import { createSignal, createEffect, JSX, onMount, onCleanup } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
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
  const [isFullscreen, setIsFullscreen] = createSignal(false);
  const [showTrafficLightOutlines, setShowTrafficLightOutlines] = createSignal(false);
  let unlistenResize: (() => void) | undefined;
  let unlistenFullscreen: (() => void) | undefined;
  let unlistenTransitionStart: (() => void) | undefined;

  // Initialize from localStorage and set up fullscreen detection on mount
  onMount(async () => {
    const savedLeft = localStorage.getItem("leftSidebarOpen");
    const savedRight = localStorage.getItem("rightSidebarOpen");
    if (savedLeft !== null) setLeftSidebarOpen(savedLeft === "true");
    if (savedRight !== null) setRightSidebarOpen(savedRight === "true");

    // Fullscreen detection - listen to Rust event for faster updates
    const appWindow = getCurrentWindow();
    setIsFullscreen(await appWindow.isFullscreen());

    // Listen for fullscreen transition starting (shows traffic light outlines)
    unlistenTransitionStart = await listen("fullscreen-transition-start", () => {
      setShowTrafficLightOutlines(true);
    });

    // Listen to custom event from Rust (fires earlier than onResized)
    unlistenFullscreen = await listen<boolean>("fullscreen-changed", (event) => {
      setIsFullscreen(event.payload);
      // Hide outlines when fullscreen transition completes
      if (event.payload === true) {
        setShowTrafficLightOutlines(false);
      }
    });

    // Fallback: also listen to resize events
    unlistenResize = await appWindow.onResized(async () => {
      setIsFullscreen(await appWindow.isFullscreen());
    });
  });

  onCleanup(() => {
    unlistenResize?.();
    unlistenFullscreen?.();
    unlistenTransitionStart?.();
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
        class="h-[var(--grid-header-height)] w-full shrink-0 flex items-center bg-[#fbfbfa] border-b border-[#e8e8e8] select-none relative"
      >
        {/* Traffic light outlines - shown during fullscreen transition */}
        {showTrafficLightOutlines() && (
          <div class="absolute left-5 top-1/2 -translate-y-1/2 flex items-center gap-2">
            <div class="w-3 h-3 rounded-full border border-[#d4d4d4]" />
            <div class="w-3 h-3 rounded-full border border-[#d4d4d4]" />
            <div class="w-3 h-3 rounded-full border border-[#d4d4d4]" />
          </div>
        )}

        {/* Toggle button - positioned to the right of traffic lights (or left edge in fullscreen) */}
        <div
          class="pr-2 transition-[padding-left] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
          classList={{
            "pl-20": !isFullscreen(),
            "pl-4": isFullscreen(),
          }}
        >
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
      <div class="flex-1 flex min-h-0 min-w-0 relative">
        {/* Left Sidebar - collapsible */}
        <aside
          class="shrink-0 border-r border-[#e8e8e8] bg-[#fbfbfa] relative z-10 overflow-hidden transition-[width,border-width] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-[width]"
          classList={{
            "w-60": leftSidebarOpen(),
            "w-0 border-r-0": !leftSidebarOpen(),
          }}
        >
          <div class="min-w-0 h-full overflow-y-auto overflow-x-hidden w-60">
            {props.leftSidebar}
          </div>
        </aside>

        {/* Center content area */}
        <main class="flex-1 flex flex-col min-h-0 min-w-0 bg-white">
          {/* Calendar grid */}
          <div class="flex-1 min-h-0 min-w-0">{props.children}</div>
        </main>

        {/* Right Sidebar - collapsible */}
        <aside
          class="shrink-0 border-l border-[#e8e8e8] bg-[#fbfbfa] relative z-10 overflow-hidden transition-[width,border-width] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-[width]"
          classList={{
            "w-60": rightSidebarOpen(),
            "w-0 border-l-0": !rightSidebarOpen(),
          }}
        >
          <div class="min-w-0 h-full overflow-y-auto overflow-x-hidden w-60">
            {props.rightSidebar}
          </div>
        </aside>
      </div>
    </div>
  );
}
