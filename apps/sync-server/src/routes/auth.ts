import { Hono } from "hono";
import { googleAuth } from "@hono/oauth-providers/google";
import { eq, and, gt } from "drizzle-orm";
import { db } from "../db/index.js";
import { sessions, users } from "../db/schema.js";
import { authMiddleware } from "../middlewares/auth.js";
import { renderOAuthSuccessPage } from "../lib/oauth-success-page.js";
import { createOAuthState, validateOAuthState, pollOAuthState } from "../services/oauth-state.js";
import { handleOAuthCallback } from "../services/oauth-callback.js";
import { verifySessionToken } from "../lib/jwt.js";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

export const authRoute = new Hono()
  .get("/start", async (c) => {
    if (!db) {
      return c.json({ error: "Database not configured" }, 500);
    }

    const state = c.req.query("state");
    if (!state) {
      return c.json({ error: "Missing state parameter" }, 400);
    }

    const isValid = await validateOAuthState(state);
    if (!isValid) {
      return c.json({ error: "Invalid or expired state" }, 400);
    }

    c.header("Set-Cookie", `oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);
    return c.redirect("/auth/google");
  })
  .post("/state", async (c) => {
    if (!db) {
      return c.json({ error: "Database not configured" }, 500);
    }

    // Optionally extract userId from auth header (for "add account" flow)
    let userId: string | undefined;
    const authHeader = c.req.header("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const payload = await verifySessionToken(authHeader.slice(7));
        const session = await db.query.sessions.findFirst({
          where: and(
            eq(sessions.id, payload.sessionId),
            gt(sessions.expiresAt, new Date())
          ),
        });
        if (session) {
          userId = payload.sub;
        }
      } catch {
        // No valid auth — first-time OAuth, proceed without userId
      }
    }

    const state = await createOAuthState(userId);
    return c.json({ state });
  })
  .get("/poll", async (c) => {
    if (!db) {
      return c.json({ error: "Database not configured" }, 500);
    }

    const state = c.req.query("state");
    if (!state) {
      return c.json({ error: "Missing state parameter" }, 400);
    }

    const result = await pollOAuthState(state);

    if ("status" in result) {
      return c.json({ status: "pending" }, 202);
    }
    if ("token" in result) {
      return c.json({ token: result.token });
    }
    // Error case
    if (result.expired) {
      return c.json({ error: result.error }, 410);
    }
    return c.json({ error: result.error }, 404);
  })
  .use(
    "/google",
    googleAuth({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      scope: GOOGLE_SCOPES,
      access_type: "offline",
      prompt: "consent",
    })
  )
  .get("/google", async (c) => {
    if (!db) {
      return c.html(
        `<html><body><h1>Error</h1><p>Database not configured</p></body></html>`,
        500
      );
    }

    const accessToken = c.get("token");
    const refreshToken = c.get("refresh-token");
    const googleUser = c.get("user-google");

    if (!accessToken || !googleUser?.email || !googleUser?.id) {
      return c.html(
        `<html><body><h1>Error</h1><p>Failed to get user info from Google</p></body></html>`,
        400
      );
    }

    if (!refreshToken?.token) {
      return c.html(
        `<html><body><h1>Error</h1><p>No refresh token received. Please revoke access and try again.</p></body></html>`,
        400
      );
    }

    try {
      const cookieHeader = c.req.header("Cookie") || "";
      const stateMatch = cookieHeader.match(/oauth_state=([^;]+)/);
      const pendingState = stateMatch ? stateMatch[1] : null;

      const { jwt } = await handleOAuthCallback({
        provider: "google",
        accessToken,
        refreshToken: refreshToken.token,
        providerUser: { id: googleUser.id, email: googleUser.email },
        pendingState,
      });

      if (pendingState) {
        c.header("Set-Cookie", "oauth_state=; Path=/; HttpOnly; Max-Age=0");
      }

      return c.html(renderOAuthSuccessPage(jwt));
    } catch (error) {
      console.error("OAuth callback error:", error);
      return c.html(
        `<html><body><h1>Error</h1><p>Failed to save account: ${error instanceof Error ? error.message : "Unknown error"}</p></body></html>`,
        500
      );
    }
  })
  .post("/logout", authMiddleware, async (c) => {
    if (!db) {
      return c.json({ error: "Database not configured" }, 500);
    }

    const sessionId = c.get("sessionId");
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return c.json({ success: true });
  })
  .get("/me", authMiddleware, async (c) => {
    if (!db) {
      return c.json({ error: "Database not configured" }, 500);
    }

    const userId = c.get("userId");
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    return c.json({
      id: user.id,
      email: user.email,
    });
  });
