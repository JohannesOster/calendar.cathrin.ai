import "dotenv/config";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { healthRoute } from "./routes/health.js";
import { authRoute } from "./routes/auth.js";
import { accountsRoute } from "./routes/accounts.js";
import { calendarsRoute } from "./routes/calendars.js";
import { eventsRoute } from "./routes/events.js";
import { webhooksRoute } from "./routes/webhooks.js";
import { closeDatabase } from "./db/index.js";
import {
  startBackgroundSync,
  stopBackgroundSync,
} from "./services/background-sync.js";
import { addConnection, removeConnection, shutdownWsManager } from "./services/ws-manager.js";
import { verifySessionToken } from "./lib/jwt.js";
import { db } from "./db/index.js";
import { sessions } from "./db/schema.js";
import { eq, and, gt } from "drizzle-orm";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Middleware
app.use("*", logger());

// CORS configuration
// In production, only allow Tauri webview origins
// In development, also allow Vite dev server
const isDevelopment = process.env.NODE_ENV !== "production";
const tauriOrigins = [
  "tauri://localhost", // Tauri webview (macOS)
  "https://tauri.localhost", // Tauri webview (Windows)
  "http://tauri.localhost", // Tauri webview alternative
];

app.use(
  "*",
  cors({
    origin: isDevelopment
      ? (origin) => {
          // In development, allow any localhost port (parallel worktrees)
          if (origin.startsWith("http://localhost:")) return origin;
          if (tauriOrigins.includes(origin)) return origin;
          return undefined;
        }
      : tauriOrigins,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// WebSocket route — authenticate via query param token
app.get(
  "/ws",
  upgradeWebSocket((c) => {
    let userId: string | null = null;

    return {
      async onOpen(_event, ws) {
        // Authenticate using query param token
        const token = c.req.query("token");
        if (!token || !db) {
          ws.close(4001, "Unauthorized");
          return;
        }

        try {
          const payload = await verifySessionToken(token);

          // Verify session exists and is not expired
          const session = await db.query.sessions.findFirst({
            where: and(
              eq(sessions.id, payload.sessionId),
              gt(sessions.expiresAt, new Date())
            ),
          });

          if (!session) {
            ws.close(4001, "Session expired");
            return;
          }

          userId = payload.sub;
          addConnection(userId, ws);
        } catch {
          ws.close(4001, "Invalid token");
        }
      },
      onMessage(event, _ws) {
        // Handle client messages (e.g. pong)
        try {
          const data = JSON.parse(typeof event.data === "string" ? event.data : "{}");
          if (data.type === "pong") {
            // Client responded to heartbeat — connection is alive
          }
        } catch {
          // Ignore malformed messages
        }
      },
      onClose(_event, ws) {
        if (userId) {
          removeConnection(userId, ws);
        }
      },
      onError(_event, ws) {
        if (userId) {
          removeConnection(userId, ws);
        }
      },
    };
  })
);

// Routes
const routes = app
  .route("/health", healthRoute)
  .route("/auth", authRoute)
  .route("/api/accounts", accountsRoute)
  .route("/api/calendars", calendarsRoute)
  .route("/api/events", eventsRoute)
  .route("/webhooks", webhooksRoute);

// Export type for RPC client (future use)
export type AppType = typeof routes;

// Server setup
const port = Number(process.env.PORT) || 3000;

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);

  // Inject WebSocket handler into the HTTP server
  injectWebSocket(server);

  // Start background sync service
  startBackgroundSync();
});

// Graceful shutdown
const shutdown = async () => {
  console.log("\nShutting down gracefully...");

  // Stop background sync and close WebSocket connections
  stopBackgroundSync();
  shutdownWsManager();

  await closeDatabase();

  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
