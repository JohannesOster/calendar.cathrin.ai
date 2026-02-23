import { createSignal } from "solid-js";

/**
 * Shared signal that ticks every 60 seconds.
 * Used by CurrentTimeIndicator and past-event dimming.
 */
const [currentMinute, setCurrentMinute] = createSignal(new Date());

setInterval(() => setCurrentMinute(new Date()), 60_000);

export { currentMinute };
