import { Hono } from "hono";
import { checkDatabaseConnection } from "../db/index.js";

export const healthRoute = new Hono().get("/", async (c) => {
  const dbConnected = await checkDatabaseConnection();

  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    db: dbConnected ? "connected" : "disconnected",
  });
});
