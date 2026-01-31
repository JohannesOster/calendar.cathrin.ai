import { createMiddleware } from "hono/factory";
import { eq, and, gt } from "drizzle-orm";
import { db } from "../db/index.js";
import { sessions } from "../db/schema.js";
import { verifySessionToken, type JwtPayload } from "../lib/jwt.js";

// Extend Hono's context with our custom variables
declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    sessionId: string;
  }
}

/**
 * Auth middleware that validates JWT and checks session in database
 *
 * Validates:
 * 1. Authorization header is present with Bearer token
 * 2. JWT signature is valid
 * 3. JWT is not expired
 * 4. Session exists in database and is not expired
 */
export const authMiddleware = createMiddleware(async (c, next) => {
  if (!db) {
    return c.json({ error: "Database not configured" }, 500);
  }

  // Get Authorization header
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix

  // Verify JWT
  let payload: JwtPayload;
  try {
    payload = await verifySessionToken(token);
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  // Check session exists and is not expired
  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.id, payload.sessionId),
      gt(sessions.expiresAt, new Date())
    ),
  });

  if (!session) {
    return c.json({ error: "Session expired or revoked" }, 401);
  }

  // Set userId and sessionId in context for downstream handlers
  c.set("userId", payload.sub);
  c.set("sessionId", payload.sessionId);

  await next();
});
