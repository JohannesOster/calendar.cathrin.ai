import "dotenv/config";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { healthRoute } from "./routes/health.js";
import { closeDatabase } from "./db/index.js";

const app = new Hono();

// Middleware
app.use("*", logger());

// Routes
const routes = app.route("/health", healthRoute);

// Export type for RPC client (future use)
export type AppType = typeof routes;

// Server setup
const port = Number(process.env.PORT) || 3000;

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log("\nShutting down gracefully...");

  await closeDatabase();

  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
