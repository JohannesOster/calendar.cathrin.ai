import { Hono } from "hono";
import { googleAuth } from "@hono/oauth-providers/google";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, accounts } from "../db/schema.js";
import { encrypt } from "../lib/crypto.js";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

export const authRoute = new Hono()
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
      } else {
        // Create new account
        await db.insert(accounts).values({
          userId: user.id,
          provider: "google",
          providerAccountId: googleUser.id,
          email: googleUser.email,
          encryptedRefreshToken: encrypt(refreshToken.token),
          encryptedAccessToken: accessToken.token
            ? encrypt(accessToken.token)
            : null,
          tokenExpiresAt,
        });
      }

      // Success page that can be closed or redirect to app
      return c.html(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Connected!</title>
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
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Connected!</h1>
              <p>Your Google Calendar account has been connected.</p>
              <p>You can close this window.</p>
            </div>
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
  });
