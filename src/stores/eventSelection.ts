import { createSignal } from "solid-js";

const [selectedEventId, setSelectedEventId] = createSignal<string | null>(null);

export function selectEvent(id: string): void {
  setSelectedEventId(id);
}

export function deselectEvent(): void {
  setSelectedEventId(null);
}

export function isEventSelected(id: string): boolean {
  return selectedEventId() === id;
}

export { selectedEventId };
