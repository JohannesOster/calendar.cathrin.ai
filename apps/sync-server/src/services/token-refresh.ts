import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts } from "../db/schema.js";
import { encrypt, decrypt } from "../lib/crypto.js";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000; // Refresh 60 seconds before expiry

/**
 * Error thrown when user has revoked access and must re-authorize
 */
export class TokenRevokedError extends Error {
  constructor(message = "User must re-authorize") {
    super(message);
    this.name = "TokenRevokedError";
  }
}

/**
 * Error thrown when token refresh fails for other reasons
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

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface GoogleErrorResponse {
  error: string;
  error_description?: string;
}

/**
 * Refresh access token using Google's token endpoint
 */
async function refreshGoogleToken(
  refreshToken: string
): Promise<GoogleTokenResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new TokenRefreshError(
      "Google OAuth credentials not configured",
      "missing_credentials"
    );
  }

  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    const error = data as GoogleErrorResponse;

    // invalid_grant means the refresh token is no longer valid
    // User revoked access, or token was somehow invalidated
    if (error.error === "invalid_grant") {
      throw new TokenRevokedError(
        error.error_description || "Refresh token is no longer valid"
      );
    }

    throw new TokenRefreshError(
      error.error_description || error.error || "Failed to refresh token",
      error.error
    );
  }

  return data as GoogleTokenResponse;
}

/**
 * Get a valid access token for an account, refreshing if needed
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

  // Need to refresh - decrypt the refresh token
  const refreshToken = decrypt(account.encryptedRefreshToken);

  try {
    const newTokens = await refreshGoogleToken(refreshToken);

    // Store new access token
    await db
      .update(accounts)
      .set({
        encryptedAccessToken: encrypt(newTokens.access_token),
        tokenExpiresAt: new Date(now + newTokens.expires_in * 1000),
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, accountId));

    return newTokens.access_token;
  } catch (error) {
    if (error instanceof TokenRevokedError) {
      // Mark account as needing re-authorization
      await db
        .update(accounts)
        .set({
          encryptedAccessToken: null,
          tokenExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, accountId));
    }
    throw error;
  }
}

/**
 * Force refresh the access token, bypassing cache
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

  // Decrypt the refresh token
  const refreshToken = decrypt(account.encryptedRefreshToken);

  try {
    const newTokens = await refreshGoogleToken(refreshToken);

    // Store new access token
    await db
      .update(accounts)
      .set({
        encryptedAccessToken: encrypt(newTokens.access_token),
        tokenExpiresAt: new Date(Date.now() + newTokens.expires_in * 1000),
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, accountId));

    return newTokens.access_token;
  } catch (error) {
    if (error instanceof TokenRevokedError) {
      // Mark account as needing re-authorization
      await db
        .update(accounts)
        .set({
          encryptedAccessToken: null,
          tokenExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, accountId));
    }
    throw error;
  }
}
