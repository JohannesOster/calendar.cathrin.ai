import { GoogleApiError, TokenExpiredError } from "../services/google-calendar.js";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function handleGoogleApiError(error: unknown, c: Context): Response | null {
  if (error instanceof TokenExpiredError) {
    return c.json({ error: "Token expired - re-authorization required" }, 401);
  }
  if (error instanceof GoogleApiError) {
    return c.json({ error: error.message }, error.statusCode as ContentfulStatusCode);
  }
  return null;
}
