import { TokenExpiredError, ProviderApiError } from "../providers/types.js";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function handleProviderError(error: unknown, c: Context): Response | null {
  if (error instanceof TokenExpiredError) {
    return c.json({ error: "Token expired - re-authorization required" }, 401);
  }
  if (error instanceof ProviderApiError) {
    return c.json({ error: error.message }, error.statusCode as ContentfulStatusCode);
  }
  return null;
}
