import { Hono } from "hono";
import { googleAuth } from "@hono/oauth-providers/google";
import { eq, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, accounts, sessions, oauthPendingTokens } from "../db/schema.js";
import { encrypt } from "../lib/crypto.js";
import { createSessionToken, getSessionExpiresAt } from "../lib/jwt.js";
import { authMiddleware } from "../middlewares/auth.js";
import { performInitialSync } from "../services/initial-sync.js";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

export const authRoute = new Hono()
  // Start OAuth flow with state parameter from desktop client
  // Desktop creates state, then opens browser to this endpoint
  .get("/start", async (c) => {
    if (!db) {
      return c.json({ error: "Database not configured" }, 500);
    }

    const state = c.req.query("state");
    if (!state) {
      return c.json({ error: "Missing state parameter" }, 400);
    }

    // Verify state exists in database
    const pending = await db.query.oauthPendingTokens.findFirst({
      where: eq(oauthPendingTokens.state, state),
    });

    if (!pending || pending.expiresAt < new Date()) {
      return c.json({ error: "Invalid or expired state" }, 400);
    }

    // Set state in cookie so we can retrieve it after OAuth callback
    c.header("Set-Cookie", `oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);

    // Redirect to Google OAuth
    return c.redirect("/auth/google");
  })
  // Create a pending OAuth state (called before opening browser)
  .post("/state", async (c) => {
    if (!db) {
      return c.json({ error: "Database not configured" }, 500);
    }

    // Generate a random state
    const state = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store pending state
    await db.insert(oauthPendingTokens).values({
      state,
      expiresAt,
    });

    // Clean up expired tokens (fire and forget)
    db.delete(oauthPendingTokens)
      .where(lt(oauthPendingTokens.expiresAt, new Date()))
      .catch(() => {});

    return c.json({ state });
  })
  // Poll for OAuth completion
  .get("/poll", async (c) => {
    if (!db) {
      return c.json({ error: "Database not configured" }, 500);
    }

    const state = c.req.query("state");
    if (!state) {
      return c.json({ error: "Missing state parameter" }, 400);
    }

    const pending = await db.query.oauthPendingTokens.findFirst({
      where: eq(oauthPendingTokens.state, state),
    });

    if (!pending) {
      return c.json({ error: "State not found or expired" }, 404);
    }

    if (pending.expiresAt < new Date()) {
      await db.delete(oauthPendingTokens).where(eq(oauthPendingTokens.state, state));
      return c.json({ error: "State expired" }, 410);
    }

    if (pending.error) {
      await db.delete(oauthPendingTokens).where(eq(oauthPendingTokens.state, state));
      return c.json({ error: pending.error }, 400);
    }

    if (!pending.token) {
      return c.json({ status: "pending" }, 202);
    }

    // Token is ready - delete the pending entry and return it
    await db.delete(oauthPendingTokens).where(eq(oauthPendingTokens.state, state));
    return c.json({ token: pending.token });
  })
  // Google OAuth middleware
  .use(
    "/google",
    googleAuth({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      scope: GOOGLE_SCOPES,
      access_type: "offline", // Get refresh token
      prompt: "consent", // Always show consent to ensure refresh token
    })
  )
  // Google OAuth callback handler
  .get("/google", async (c) => {
    if (!db) {
      return c.html(
        `<html><body><h1>Error</h1><p>Database not configured</p></body></html>`,
        500
      );
    }

    // Get tokens from OAuth middleware
    // token = access token, refresh-token = refresh token
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
      // Find or create user
      let user = await db.query.users.findFirst({
        where: eq(users.email, googleUser.email),
      });

      if (!user) {
        const [newUser] = await db
          .insert(users)
          .values({ email: googleUser.email })
          .returning();
        user = newUser;
      }

      // Check if account already exists
      const existingAccount = await db.query.accounts.findFirst({
        where: eq(accounts.providerAccountId, googleUser.id),
      });

      const tokenExpiresAt = accessToken.expires_in
        ? new Date(Date.now() + accessToken.expires_in * 1000)
        : null;

      let accountId: string;
      let isNewAccount = false;

      if (existingAccount) {
        // Update existing account with new tokens
        await db
          .update(accounts)
          .set({
            encryptedRefreshToken: encrypt(refreshToken.token),
            encryptedAccessToken: accessToken.token
              ? encrypt(accessToken.token)
              : null,
            tokenExpiresAt,
            updatedAt: new Date(),
          })
          .where(eq(accounts.id, existingAccount.id));
        accountId = existingAccount.id;
      } else {
        // Create new account
        const [newAccount] = await db
          .insert(accounts)
          .values({
            userId: user.id,
            provider: "google",
            providerAccountId: googleUser.id,
            email: googleUser.email,
            encryptedRefreshToken: encrypt(refreshToken.token),
            encryptedAccessToken: accessToken.token
              ? encrypt(accessToken.token)
              : null,
            tokenExpiresAt,
            syncStatus: "pending",
          })
          .returning();
        accountId = newAccount.id;
        isNewAccount = true;
      }

      // Trigger initial sync for new accounts (fire and forget)
      if (isNewAccount) {
        performInitialSync(accountId).catch((err) => {
          console.error(`[auth] Initial sync failed for account ${accountId}:`, err);
        });
      }

      // Create session and JWT
      const [session] = await db
        .insert(sessions)
        .values({
          userId: user.id,
          expiresAt: getSessionExpiresAt(),
        })
        .returning();

      const jwt = await createSessionToken(user.id, session.id);

      // Check if there's a pending state in cookie (desktop flow)
      const cookieHeader = c.req.header("Cookie") || "";
      const stateMatch = cookieHeader.match(/oauth_state=([^;]+)/);
      const pendingState = stateMatch ? stateMatch[1] : null;

      if (pendingState) {
        // Store the token for the desktop app to poll
        await db
          .update(oauthPendingTokens)
          .set({ token: jwt })
          .where(eq(oauthPendingTokens.state, pendingState));

        // Clear the cookie
        c.header("Set-Cookie", "oauth_state=; Path=/; HttpOnly; Max-Age=0");
      }

      // Success page that shows the token for the desktop app to capture
      // The desktop app will read this from the page or we can use a custom protocol
      return c.html(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Connected!</title>
            <meta name="session-token" content="${jwt}">
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background: #f5f5f5;
              }
              .container {
                text-align: center;
                padding: 2rem;
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              }
              h1 { color: #10b981; margin-bottom: 0.5rem; }
              p { color: #666; }
              .token {
                margin-top: 1rem;
                padding: 0.5rem;
                background: #f0f0f0;
                border-radius: 4px;
                font-family: monospace;
                font-size: 0.75rem;
                word-break: break-all;
                max-width: 400px;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Connected!</h1>
              <p>Your Google Calendar account has been connected.</p>
              <p>You can close this window.</p>
              <div class="token" id="token" style="display: none;">${jwt}</div>
            </div>
            <script>
              // Notify the desktop app via custom protocol or window message
              if (window.opener) {
                window.opener.postMessage({ type: 'oauth-success', token: '${jwt}' }, '*');
              }
            </script>
          </body>
        </html>
      `);
    } catch (error) {
      console.error("OAuth callback error:", error);
      return c.html(
        `<html><body><h1>Error</h1><p>Failed to save account: ${error instanceof Error ? error.message : "Unknown error"}</p></body></html>`,
        500
      );
    }
  })
  // Logout endpoint - invalidates session
  .post("/logout", authMiddleware, async (c) => {
    if (!db) {
      return c.json({ error: "Database not configured" }, 500);
    }

    const sessionId = c.get("sessionId");

    // Delete session from database
    await db.delete(sessions).where(eq(sessions.id, sessionId));

    return c.json({ success: true });
  })
  // Get current user info
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
