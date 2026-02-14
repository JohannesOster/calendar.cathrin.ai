import { createSignal } from "solid-js";

const STORAGE_KEY = "cathrin:pending-notification-event-ids";

function loadFromStorage(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* corrupted data, start fresh */ }
  return new Set();
}

function saveToStorage(ids: Set<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

export const [pendingNotificationEventIds, setPendingNotificationEventIds] =
  createSignal<Set<string>>(loadFromStorage());

export function isPendingNotification(eventId: string): boolean {
  return pendingNotificationEventIds().has(eventId);
}

export function addPendingNotification(eventId: string): void {
  setPendingNotificationEventIds((prev) => {
    const next = new Set(prev);
    next.add(eventId);
    saveToStorage(next);
    return next;
  });
}

export function removePendingNotification(eventId: string): void {
  setPendingNotificationEventIds((prev) => {
    const next = new Set(prev);
    next.delete(eventId);
    saveToStorage(next);
    return next;
  });
}
