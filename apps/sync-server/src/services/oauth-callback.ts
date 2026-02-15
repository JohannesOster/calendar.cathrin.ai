import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, accounts, sessions, oauthPendingTokens } from "../db/schema.js";
import { encrypt } from "../lib/crypto.js";
import { createSessionToken, getSessionExpiresAt } from "../lib/jwt.js";
import { performInitialSync } from "./initial-sync.js";

import type { Provider } from "@cathrin/shared-types";

interface OAuthCallbackParams {
  provider: Provider;
  accessToken: { token?: string; expires_in?: number };
  refreshToken: string;
  providerUser: { id: string; email: string };
  pendingState: string | null;
}

interface OAuthCallbackResult {
  jwt: string;
  isNewAccount: boolean;
}

/**
 * Handle the OAuth callback: find/create user, upsert account,
 * encrypt tokens, trigger initial sync for new accounts,
 * create session + JWT, store JWT in pending tokens if desktop flow.
 */
export async function handleOAuthCallback(
  params: OAuthCallbackParams
): Promise<OAuthCallbackResult> {
  const { provider, accessToken, refreshToken, providerUser, pendingState } = params;

  // Check if this OAuth flow was initiated by an existing user (adding another account)
  let existingUserId: string | null = null;
  if (pendingState) {
    const pendingRow = await db!.query.oauthPendingTokens.findFirst({
      where: eq(oauthPendingTokens.state, pendingState),
    });
    existingUserId = pendingRow?.userId ?? null;
  }

  // Find or create user
  let user;
  if (existingUserId) {
    // "Add account" flow — link to the existing user
    user = await db!.query.users.findFirst({
      where: eq(users.id, existingUserId),
    });
  }

  if (!user) {
    // First-time OAuth or fallback — find/create by provider email
    user = await db!.query.users.findFirst({
      where: eq(users.email, providerUser.email),
    });

    if (!user) {
      const [newUser] = await db!
        .insert(users)
        .values({ email: providerUser.email })
        .returning();
      user = newUser;
    }
  }

  // Check if account already exists
  const existingAccount = await db!.query.accounts.findFirst({
    where: eq(accounts.providerAccountId, providerUser.id),
  });

  const tokenExpiresAt = accessToken.expires_in
    ? new Date(Date.now() + accessToken.expires_in * 1000)
    : null;

  let accountId: string;
  let isNewAccount = false;

  if (existingAccount) {
    // Update existing account with new tokens
    await db!
      .update(accounts)
      .set({
        encryptedRefreshToken: encrypt(refreshToken),
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
    const [newAccount] = await db!
      .insert(accounts)
      .values({
        userId: user.id,
        provider,
        providerAccountId: providerUser.id,
        email: providerUser.email,
        encryptedRefreshToken: encrypt(refreshToken),
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
  const [session] = await db!
    .insert(sessions)
    .values({
      userId: user.id,
      expiresAt: getSessionExpiresAt(),
    })
    .returning();

  const jwt = await createSessionToken(user.id, session.id);

  // Store JWT in pending tokens for desktop polling flow
  if (pendingState) {
    await db!
      .insert(oauthPendingTokens)
      .values({
        state: pendingState,
        token: jwt,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      })
      .onConflictDoUpdate({
        target: oauthPendingTokens.state,
        set: { token: jwt },
      });
  }

  return { jwt, isNewAccount };
}
