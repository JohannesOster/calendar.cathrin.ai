import type { ApiCalendar, ApiCalendarEvent } from "@cathrin/shared-types";
import {
  TokenRevokedError,
  type CalendarProvider,
  type ProviderCapabilities,
  type AuthUrlParams,
  type TokenPair,
  type EventFetchOptions,
  type EventFetchResult,
  type IncrementalSyncResult,
  type NewProviderEvent,
  type ProviderEventPatch,
  type MutationOptions,
  type RsvpResponse,
} from "../types.js";

const MS_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MS_GRAPH_ME_URL = "https://graph.microsoft.com/v1.0/me";

const OUTLOOK_SCOPES = [
  "offline_access",
  "Calendars.ReadWrite",
  "People.Read",
  "User.Read",
  "openid",
];

// =============================================================================
// PKCE Helpers
// =============================================================================

// In-memory store for PKCE verifiers keyed by state.
// Short-lived — entries are created at /login and consumed at /callback.
const pkceVerifiers = new Map<string, { verifier: string; expiresAt: number }>();
const PKCE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Store a PKCE verifier for later retrieval at callback time.
 */
export function storePkceVerifier(state: string, verifier: string): void {
  // Clean up expired entries (best effort)
  const now = Date.now();
  for (const [key, entry] of pkceVerifiers) {
    if (entry.expiresAt < now) pkceVerifiers.delete(key);
  }

  pkceVerifiers.set(state, { verifier, expiresAt: now + PKCE_TTL_MS });
}

/**
 * Retrieve and consume a PKCE verifier.
 */
export function consumePkceVerifier(state: string): string | null {
  const entry = pkceVerifiers.get(state);
  if (!entry) return null;

  pkceVerifiers.delete(state);

  if (entry.expiresAt < Date.now()) return null;
  return entry.verifier;
}

// =============================================================================
// User profile fetcher
// =============================================================================

interface MsGraphUser {
  id: string;
  mail?: string;
  userPrincipalName: string;
  displayName?: string;
}

/**
 * Fetch the authenticated user's profile from Microsoft Graph.
 */
export async function fetchMicrosoftUserProfile(
  accessToken: string
): Promise<{ id: string; email: string }> {
  const response = await fetch(MS_GRAPH_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to fetch Microsoft user profile: ${response.status} ${body}`);
  }

  const user = (await response.json()) as MsGraphUser;
  return {
    id: user.id,
    email: user.mail || user.userPrincipalName,
  };
}

// =============================================================================
// Outlook Calendar Provider
// =============================================================================

/**
 * Outlook Calendar provider implementation.
 * Auth methods are fully implemented. Calendar/event methods are stubs
 * that will be implemented in subsequent issues (#206, #207, #208).
 */
export class OutlookCalendarProvider implements CalendarProvider {
  readonly id = "outlook" as const;
  readonly displayName = "Outlook Calendar";
  readonly capabilities: ProviderCapabilities = {
    incrementalSync: true,
    webhooks: true,
    moveEvent: false, // Outlook uses copy+delete, implemented later
    conferenceCreate: false, // Teams meeting creation via Graph is more complex
  };

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  getAuthUrl(params: AuthUrlParams): string {
    const url = new URL(MS_AUTH_URL);
    url.searchParams.set("client_id", params.clientId);
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("scope", OUTLOOK_SCOPES.join(" "));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("response_mode", "query");
    if (params.state) url.searchParams.set("state", params.state);
    if (params.codeChallenge) {
      url.searchParams.set("code_challenge", params.codeChallenge);
      url.searchParams.set("code_challenge_method", params.codeChallengeMethod || "S256");
    }
    return url.toString();
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<TokenPair> {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    if (!clientId) {
      throw new Error("Microsoft OAuth credentials not configured");
    }

    const body = new URLSearchParams({
      client_id: clientId,
      scope: OUTLOOK_SCOPES.join(" "),
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    if (codeVerifier) {
      body.set("code_verifier", codeVerifier);
    }

    const response = await fetch(MS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => response.statusText);
      throw new Error(`Microsoft token exchange failed: ${errorBody}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  async refreshToken(refreshToken: string): Promise<TokenPair> {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    if (!clientId) {
      throw new Error("Microsoft OAuth credentials not configured");
    }

    const response = await fetch(MS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        scope: OUTLOOK_SCOPES.join(" "),
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as {
        error?: string;
        error_description?: string;
      };
      // Microsoft uses "invalid_grant" or "interaction_required" for revoked/expired tokens
      if (data.error === "invalid_grant" || data.error === "interaction_required") {
        throw new TokenRevokedError(data.error_description || "Refresh token is no longer valid");
      }
      throw new Error(`Microsoft token refresh failed: ${data.error_description || data.error || response.statusText}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    return {
      accessToken: data.access_token,
      // Microsoft may issue a new refresh token on each refresh
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  // ---------------------------------------------------------------------------
  // Read (stubs — implemented in #206)
  // ---------------------------------------------------------------------------

  async getCalendars(_accessToken: string): Promise<ApiCalendar[]> {
    throw new Error("OutlookCalendarProvider.getCalendars not yet implemented");
  }

  async getEvents(
    _accessToken: string,
    _calendarId: string,
    _options: EventFetchOptions,
  ): Promise<EventFetchResult> {
    throw new Error("OutlookCalendarProvider.getEvents not yet implemented");
  }

  async getEventsIncremental(
    _accessToken: string,
    _calendarId: string,
    _syncToken: string,
    _options: Pick<EventFetchOptions, "calendarColor" | "calendarAccessRole">,
  ): Promise<IncrementalSyncResult> {
    throw new Error("OutlookCalendarProvider.getEventsIncremental not yet implemented");
  }

  // ---------------------------------------------------------------------------
  // Write (stubs — implemented in #207)
  // ---------------------------------------------------------------------------

  async createEvent(
    _accessToken: string,
    _calendarId: string,
    _event: NewProviderEvent,
    _options?: MutationOptions,
  ): Promise<ApiCalendarEvent> {
    throw new Error("OutlookCalendarProvider.createEvent not yet implemented");
  }

  async updateEvent(
    _accessToken: string,
    _calendarId: string,
    _eventId: string,
    _patch: ProviderEventPatch,
    _options?: MutationOptions,
  ): Promise<ApiCalendarEvent> {
    throw new Error("OutlookCalendarProvider.updateEvent not yet implemented");
  }

  async deleteEvent(
    _accessToken: string,
    _calendarId: string,
    _eventId: string,
    _options?: MutationOptions,
  ): Promise<void> {
    throw new Error("OutlookCalendarProvider.deleteEvent not yet implemented");
  }

  async rsvpEvent(
    _accessToken: string,
    _calendarId: string,
    _eventId: string,
    _response: RsvpResponse,
    _options?: MutationOptions,
  ): Promise<void> {
    throw new Error("OutlookCalendarProvider.rsvpEvent not yet implemented");
  }
}
