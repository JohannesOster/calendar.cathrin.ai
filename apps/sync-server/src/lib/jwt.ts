import { sign as jwtSign, verify as jwtVerify } from "hono/jwt";

export interface JwtPayload {
  sub: string; // userId
  sessionId: string;
  iat: number; // issued at
  exp: number; // expires at
}

const DEFAULT_SESSION_DAYS = 30;

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  if (secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }
  return secret;
}

function getSessionDurationMs(): number {
  const days = Number(process.env.SESSION_DURATION_DAYS) || DEFAULT_SESSION_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

/**
 * Create a signed JWT for a user session
 */
export async function createSessionToken(
  userId: string,
  sessionId: string
): Promise<string> {
  const secret = getJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = Math.floor(getSessionDurationMs() / 1000);

  const payload = {
    sub: userId,
    sessionId,
    iat: now,
    exp: now + expiresIn,
  };

  return jwtSign(payload, secret);
}

/**
 * Verify and decode a JWT
 * Returns the payload if valid, throws if invalid
 */
export async function verifySessionToken(token: string): Promise<JwtPayload> {
  const secret = getJwtSecret();
  const payload = await jwtVerify(token, secret, "HS256");

  // Validate required fields
  if (
    typeof payload.sub !== "string" ||
    typeof payload.sessionId !== "string"
  ) {
    throw new Error("Invalid token payload");
  }

  return {
    sub: payload.sub,
    sessionId: payload.sessionId as string,
    iat: payload.iat ?? 0,
    exp: payload.exp ?? 0,
  };
}

/**
 * Calculate session expiry date for database storage
 */
export function getSessionExpiresAt(): Date {
  return new Date(Date.now() + getSessionDurationMs());
}
