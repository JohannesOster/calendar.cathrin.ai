import "dotenv/config";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { healthRoute } from "./routes/health.js";
import { authRoute } from "./routes/auth.js";
import { accountsRoute } from "./routes/accounts.js";
import { calendarsRoute } from "./routes/calendars.js";
import { eventsRoute } from "./routes/events.js";
import { closeDatabase } from "./db/index.js";
import {
  startBackgroundSync,
  stopBackgroundSync,
} from "./services/background-sync.js";

const app = new Hono();

// Middleware
app.use("*", logger());

// CORS configuration
// In production, only allow Tauri webview origins
// In development, also allow Vite dev server
const isDevelopment = process.env.NODE_ENV !== "production";
const corsOrigins = isDevelopment
  ? [
      "http://localhost:1430", // Vite dev server (development only)
      "tauri://localhost", // Tauri webview (macOS)
      "https://tauri.localhost", // Tauri webview (Windows)
      "http://tauri.localhost", // Tauri webview alternative
    ]
  : [
      "tauri://localhost", // Tauri webview (macOS)
      "https://tauri.localhost", // Tauri webview (Windows)
      "http://tauri.localhost", // Tauri webview alternative
    ];

if (isDevelopment) {
  console.log("[cors] Development mode - allowing localhost origins");
}

app.use(
  "*",
  cors({
    origin: corsOrigins,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Routes
const routes = app
  .route("/health", healthRoute)
  .route("/auth", authRoute)
  .route("/api/accounts", accountsRoute)
  .route("/api/calendars", calendarsRoute)
  .route("/api/events", eventsRoute);

// Export type for RPC client (future use)
export type AppType = typeof routes;

// Server setup
const port = Number(process.env.PORT) || 3000;

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);

  // Start background sync service
  startBackgroundSync();
});

// Graceful shutdown
const shutdown = async () => {
  console.log("\nShutting down gracefully...");

  // Stop background sync
  stopBackgroundSync();

  await closeDatabase();

  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
