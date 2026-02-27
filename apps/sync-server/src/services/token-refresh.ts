import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts } from "../db/schema.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { getProvider } from "../providers/registry.js";
import { TokenRevokedError } from "../providers/types.js";
import type { Provider } from "@cathrin/shared-types";

export { TokenRevokedError };

const TOKEN_REFRESH_BUFFER_MS = 60 * 1000; // Refresh 60 seconds before expiry

/**
 * Error thrown when token refresh fails for non-revocation reasons
 */
export class TokenRefreshError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = "TokenRefreshError";
  }
}

/**
 * Get a valid access token for an account, refreshing if needed.
 * Dispatches token refresh through the provider abstraction.
 *
 * @param accountId - The account ID to get token for
 * @returns A valid access token
 * @throws TokenRevokedError if the user has revoked access
 * @throws TokenRefreshError if the refresh fails for other reasons
 */
export async function getAccessToken(accountId: string): Promise<string> {
  if (!db) {
    throw new TokenRefreshError("Database not configured", "no_database");
  }

  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });

  if (!account) {
    throw new TokenRefreshError("Account not found", "not_found");
  }

  const now = Date.now();

  // Check if current access token is still valid (with buffer)
  if (
    account.encryptedAccessToken &&
    account.tokenExpiresAt &&
    account.tokenExpiresAt.getTime() > now + TOKEN_REFRESH_BUFFER_MS
  ) {
    return decrypt(account.encryptedAccessToken);
  }

  // Need to refresh — decrypt the refresh token and dispatch through provider
  const refreshToken = decrypt(account.encryptedRefreshToken);
  const provider = getProvider(account.provider as Provider);

  try {
    const newTokens = await provider.refreshToken(refreshToken);

    // Store new access token
    await db
      .update(accounts)
      .set({
        encryptedAccessToken: encrypt(newTokens.accessToken),
        tokenExpiresAt: new Date(now + newTokens.expiresIn * 1000),
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, accountId));

    return newTokens.accessToken;
  } catch (error) {
    if (error instanceof TokenRevokedError) {
      // Mark account as needing re-authorization
      await db
        .update(accounts)
        .set({
          encryptedAccessToken: null,
          tokenExpiresAt: null,
          syncStatus: "auth_error",
          syncError: "Token revoked — re-authorization required",
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, accountId));
    }
    throw error;
  }
}

/**
 * Force refresh the access token, bypassing cache.
 * Dispatches token refresh through the provider abstraction.
 *
 * @param accountId - The account ID to refresh token for
 * @returns A new access token
 * @throws TokenRevokedError if the user has revoked access
 * @throws TokenRefreshError if the refresh fails for other reasons
 */
export async function forceRefresh(accountId: string): Promise<string> {
  if (!db) {
    throw new TokenRefreshError("Database not configured", "no_database");
  }

  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });

  if (!account) {
    throw new TokenRefreshError("Account not found", "not_found");
  }

  // Decrypt the refresh token and dispatch through provider
  const refreshToken = decrypt(account.encryptedRefreshToken);
  const provider = getProvider(account.provider as Provider);

  try {
    const newTokens = await provider.refreshToken(refreshToken);

    // Store new access token
    await db
      .update(accounts)
      .set({
        encryptedAccessToken: encrypt(newTokens.accessToken),
        tokenExpiresAt: new Date(Date.now() + newTokens.expiresIn * 1000),
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, accountId));

    return newTokens.accessToken;
  } catch (error) {
    if (error instanceof TokenRevokedError) {
      // Mark account as needing re-authorization
      await db
        .update(accounts)
        .set({
          encryptedAccessToken: null,
          tokenExpiresAt: null,
          syncStatus: "auth_error",
          syncError: "Token revoked — re-authorization required",
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, accountId));
    }
    throw error;
  }
}
