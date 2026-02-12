/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";

render(() => <App />, document.getElementById("root") as HTMLElement);

// Enable transitions after first paint — prevents layout-shift animations on load
requestAnimationFrame(() => document.body.classList.remove("preload"));
