import { createSignal } from "solid-js";

export type ViewType = "Day" | "Week" | "Month";

// View state - controls which calendar view is displayed
export const [currentView, setCurrentView] = createSignal<ViewType>("Week");
