import { TokenExpiredError, TokenRevokedError, ProviderApiError } from "../providers/types.js";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function handleProviderError(error: unknown, c: Context): Response | null {
  if (error instanceof TokenRevokedError) {
    return c.json(
      { error: "token_revoked", message: "Token revoked — re-authorization required" },
      422,
    );
  }
  if (error instanceof TokenExpiredError) {
    return c.json(
      { error: "token_expired", message: "Token expired — re-authorization required" },
      422,
    );
  }
  if (error instanceof ProviderApiError) {
    if (error.statusCode === 403) {
      return c.json(
        { error: "You don't have permission to modify this calendar", code: "permission_denied" },
        403,
      );
    }
    return c.json({ error: error.message }, error.statusCode as ContentfulStatusCode);
  }
  return null;
}
