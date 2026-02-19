/* @refresh reload */
import { render } from "solid-js/web";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";

render(() => <App />, document.getElementById("root") as HTMLElement);

// Show window immediately after render — DOM is ready (SolidJS render is synchronous).
// Window starts hidden (tauri.conf.json visible:false) to prevent white flash.
getCurrentWindow().show().catch(console.error);

// Enable transitions after first paint — prevents layout-shift animations on load
requestAnimationFrame(() => document.body.classList.remove("preload"));
