import { eq, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { oauthPendingTokens } from "../db/schema.js";

/**
 * Create a new OAuth state token and store it in DB.
 * Cleans up expired tokens as a side effect.
 */
export async function createOAuthState(): Promise<string> {
  const state = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await db!.insert(oauthPendingTokens).values({
    state,
    expiresAt,
  });

  // Clean up expired tokens (fire and forget)
  db!.delete(oauthPendingTokens)
    .where(lt(oauthPendingTokens.expiresAt, new Date()))
    .catch(() => {});

  return state;
}

/**
 * Validate that an OAuth state exists and is not expired.
 */
export async function validateOAuthState(state: string): Promise<boolean> {
  const pending = await db!.query.oauthPendingTokens.findFirst({
    where: eq(oauthPendingTokens.state, state),
  });

  return !!pending && pending.expiresAt >= new Date();
}

/**
 * Poll for OAuth completion by state.
 * Returns { status: "pending" } | { token } | { error }.
 */
export async function pollOAuthState(
  state: string
): Promise<{ status: "pending" } | { token: string } | { error: string; expired?: boolean }> {
  const pending = await db!.query.oauthPendingTokens.findFirst({
    where: eq(oauthPendingTokens.state, state),
  });

  if (!pending) {
    return { error: "State not found or expired" };
  }

  if (pending.expiresAt < new Date()) {
    await db!.delete(oauthPendingTokens).where(eq(oauthPendingTokens.state, state));
    return { error: "State expired", expired: true };
  }

  if (pending.error) {
    await db!.delete(oauthPendingTokens).where(eq(oauthPendingTokens.state, state));
    return { error: pending.error };
  }

  if (!pending.token) {
    return { status: "pending" };
  }

  // Token is ready -- delete the pending entry and return it
  await db!.delete(oauthPendingTokens).where(eq(oauthPendingTokens.state, state));
  return { token: pending.token };
}
