import type { WSContext } from "hono/ws";

// =============================================================================
// WebSocket Connection Manager
// =============================================================================
// Tracks connected clients per userId. Provides notification functions for
// background-sync and event mutation routes to push changes to clients.
// =============================================================================

type ServerMessage =
  | { type: "weeks_changed"; weekIds: string[]; source: "sync" | "mutation" }
  | { type: "calendars_changed"; accountId: string }
  | { type: "ping" };

const connections = new Map<string, Set<WSContext>>();
const clientIds = new Map<WSContext, string>();

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export function addConnection(userId: string, ws: WSContext, clientId?: string): void {
  let userConns = connections.get(userId);
  if (!userConns) {
    userConns = new Set();
    connections.set(userId, userConns);
  }
  userConns.add(ws);
  if (clientId) {
    clientIds.set(ws, clientId);
  }
  console.log(
    `[ws] Client connected for user ${userId} (${userConns.size} total)`
  );

  // Start heartbeat if this is the first connection
  if (!heartbeatTimer) {
    startHeartbeat();
  }
}

export function removeConnection(userId: string, ws: WSContext): void {
  const userConns = connections.get(userId);
  if (!userConns) return;

  userConns.delete(ws);
  clientIds.delete(ws);
  if (userConns.size === 0) {
    connections.delete(userId);
  }
  console.log(
    `[ws] Client disconnected for user ${userId} (${connections.get(userId)?.size ?? 0} remaining)`
  );

  // Stop heartbeat if no connections remain
  if (connections.size === 0 && heartbeatTimer) {
    stopHeartbeat();
  }
}

export function notifyUser(userId: string, message: ServerMessage, excludeClientId?: string): void {
  const userConns = connections.get(userId);
  if (!userConns || userConns.size === 0) return;

  const payload = JSON.stringify(message);
  console.log(`[ws] Notifying user ${userId}: ${message.type}`, message);

  for (const ws of userConns) {
    if (excludeClientId && clientIds.get(ws) === excludeClientId) continue;
    try {
      ws.send(payload);
    } catch (error) {
      console.warn(`[ws] Failed to send to client:`, error);
    }
  }
}

export function getConnectionCount(): number {
  let count = 0;
  for (const conns of connections.values()) {
    count += conns.size;
  }
  return count;
}

function startHeartbeat(): void {
  heartbeatTimer = setInterval(() => {
    const payload = JSON.stringify({ type: "ping" } satisfies ServerMessage);
    for (const [userId, userConns] of connections) {
      for (const ws of userConns) {
        try {
          ws.send(payload);
        } catch {
          // Dead connection — remove it
          userConns.delete(ws);
          clientIds.delete(ws);
          if (userConns.size === 0) {
            connections.delete(userId);
          }
        }
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

export function shutdownWsManager(): void {
  stopHeartbeat();
  for (const [, userConns] of connections) {
    for (const ws of userConns) {
      try {
        ws.close(1001, "Server shutting down");
      } catch {
        // Ignore close errors during shutdown
      }
    }
  }
  connections.clear();
  clientIds.clear();
}
