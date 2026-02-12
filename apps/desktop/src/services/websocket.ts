import { sessionToken, isAuthenticated } from "../stores/auth";
import { API_BASE, CLIENT_ID } from "../lib/api";

// =============================================================================
// WebSocket Client
// =============================================================================
// Persistent connection to the sync server. Receives push notifications for
// changed weeks (from background sync or other client mutations) and triggers
// immediate re-fetch instead of waiting for the next polling cycle.
// =============================================================================

type ServerMessage =
  | { type: "weeks_changed"; weekIds: string[]; source: "sync" | "mutation" }
  | { type: "calendars_changed"; accountId: string }
  | { type: "ping" };

// Reconnection with exponential backoff
const INITIAL_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = INITIAL_RECONNECT_MS;
let intentionallyClosed = false;

// Callback for when weeks change — registered by event-polling.ts
let onWeeksChanged: ((weekIds: string[], source: "sync" | "mutation") => void) | null = null;

/**
 * Register a callback for weeks_changed messages.
 * Called by event-polling.ts to avoid circular imports.
 */
export function onWsWeeksChanged(
  callback: (weekIds: string[], source: "sync" | "mutation") => void
): void {
  onWeeksChanged = callback;
}

function getWsUrl(token: string): string {
  const base = API_BASE.replace(/^http/, "ws");
  return `${base}/ws?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(CLIENT_ID)}`;
}

/**
 * Connect to the sync server WebSocket.
 * Auto-reconnects with exponential backoff on disconnect.
 */
export function connectWebSocket(): void {
  const token = sessionToken();
  if (!token || !isAuthenticated()) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  intentionallyClosed = false;
  const url = getWsUrl(token);

  try {
    ws = new WebSocket(url);
  } catch (error) {
    console.warn("[ws] Failed to create WebSocket:", error);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log("[ws] Connected to sync server");
    // Reset backoff on successful connection
    reconnectDelay = INITIAL_RECONNECT_MS;
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as ServerMessage;

      switch (msg.type) {
        case "weeks_changed":
          console.log(
            `[ws] Received weeks_changed (${msg.source}):`,
            msg.weekIds
          );
          onWeeksChanged?.(msg.weekIds, msg.source);
          break;

        case "ping":
          // Respond with pong to keep connection alive
          ws?.send(JSON.stringify({ type: "pong" }));
          break;

        case "calendars_changed":
          // Future: trigger account/calendar refetch
          console.log("[ws] Received calendars_changed for", msg.accountId);
          break;
      }
    } catch {
      // Ignore malformed messages
    }
  };

  ws.onclose = (event) => {
    console.log(`[ws] Disconnected (code: ${event.code})`);
    ws = null;

    if (!intentionallyClosed && isAuthenticated()) {
      scheduleReconnect();
    }
  };

  ws.onerror = () => {
    // onclose will fire after onerror — reconnect logic lives there
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;

  console.log(`[ws] Reconnecting in ${reconnectDelay / 1000}s...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * BACKOFF_MULTIPLIER, MAX_RECONNECT_MS);
    connectWebSocket();
  }, reconnectDelay);
}

/**
 * Disconnect the WebSocket cleanly.
 * Called on logout or app unmount.
 */
export function disconnectWebSocket(): void {
  intentionallyClosed = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws) {
    ws.close(1000, "Client disconnecting");
    ws = null;
  }

  reconnectDelay = INITIAL_RECONNECT_MS;
}

/**
 * Check if WebSocket is currently connected.
 */
export function isWsConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}
