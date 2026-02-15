import type { ApiCalendar, ApiCalendarEvent } from "@cathrin/shared-types";
import {
  TokenRevokedError,
  TokenExpiredError,
  SyncTokenExpiredError,
  ProviderApiError,
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
  type WatchOptions,
  type WatchInfo,
  type ProviderContact,
} from "../types.js";
import type {
  GraphCalendarListResponse,
  GraphEventListResponse,
  GraphEvent,
  GraphCategoryListResponse,
  GraphCategory,
  GraphErrorResponse,
} from "./types.js";
import {
  mapGraphCalendar,
  mapGraphEvent,
  buildCategoryColorMap,
  toOutlookCreateBody,
  toOutlookPatchBody,
} from "./mappers.js";

const MS_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MS_GRAPH_URL = "https://graph.microsoft.com/v1.0";
const MS_GRAPH_ME_URL = `${MS_GRAPH_URL}/me`;

/** Standard headers for all Graph API requests — immutable IDs prevent ID changes on move. */
const GRAPH_PREFER_HEADER = 'IdType="ImmutableId"';
const MAX_RETRY_DELAY_MS = 30_000;

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
// Graph API Helpers
// =============================================================================

/**
 * Make a Graph API request with immutable ID preference and error handling.
 * Retries on 429 with Retry-After backoff (max 3 retries).
 */
async function graphFetch(
  url: string,
  accessToken: string,
  options: RequestInit = {},
  retryCount = 0,
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Prefer: GRAPH_PREFER_HEADER,
    ...(options.headers as Record<string, string> || {}),
  };

  const response = await fetch(url, { ...options, headers });

  // Handle 429 Too Many Requests — retry with Retry-After
  if (response.status === 429) {
    if (retryCount >= 3) {
      throw new ProviderApiError("Outlook API rate limit exceeded after retries", 429);
    }
    const retryAfter = response.headers.get("Retry-After");
    const delayMs = Math.min(
      (retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000),
      MAX_RETRY_DELAY_MS,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return graphFetch(url, accessToken, options, retryCount + 1);
  }

  return response;
}

/**
 * Handle non-2xx Graph API responses, throwing typed errors.
 */
async function handleGraphError(response: Response): Promise<never> {
  if (response.status === 401) {
    throw new TokenExpiredError();
  }

  // 410 Gone with resyncRequired → delta token expired
  if (response.status === 410) {
    throw new SyncTokenExpiredError();
  }

  let message = response.statusText;
  try {
    const body = (await response.json()) as GraphErrorResponse;
    message = body.error?.message || JSON.stringify(body);
  } catch {
    // Fall back to statusText
  }

  throw new ProviderApiError(`Outlook API error: ${message}`, response.status);
}

// =============================================================================
// Category Cache
// =============================================================================

/** Per-token category cache with 1-hour TTL, max 20 entries. */
const categoryCache = new Map<string, { categories: GraphCategory[]; expiresAt: number }>();
const CATEGORY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CATEGORY_CACHE_MAX_SIZE = 20;

async function fetchCategories(accessToken: string): Promise<GraphCategory[]> {
  // Use first 16 chars of token as cache key (enough to distinguish tokens)
  const cacheKey = accessToken.slice(0, 16);
  const cached = categoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.categories;
  }

  const response = await graphFetch(
    `${MS_GRAPH_URL}/me/outlook/masterCategories`,
    accessToken,
  );

  if (!response.ok) {
    // Non-critical — return empty list, events will use calendar color
    console.warn("[outlook] Failed to fetch categories, using defaults");
    return [];
  }

  const data = (await response.json()) as GraphCategoryListResponse;

  // Evict expired entries and cap size to prevent unbounded growth
  const now = Date.now();
  for (const [key, entry] of categoryCache) {
    if (entry.expiresAt < now) categoryCache.delete(key);
  }
  if (categoryCache.size >= CATEGORY_CACHE_MAX_SIZE) {
    const oldest = categoryCache.keys().next().value;
    if (oldest) categoryCache.delete(oldest);
  }

  categoryCache.set(cacheKey, {
    categories: data.value,
    expiresAt: now + CATEGORY_CACHE_TTL_MS,
  });
  return data.value;
}

// =============================================================================
// Outlook Calendar Provider
// =============================================================================

/**
 * Outlook Calendar provider implementation.
 * Uses Microsoft Graph API v1.0 with immutable IDs.
 */
export class OutlookCalendarProvider implements CalendarProvider {
  readonly id = "outlook" as const;
  readonly displayName = "Outlook Calendar";
  readonly capabilities: ProviderCapabilities = {
    incrementalSync: true,
    webhooks: true,
    moveEvent: true, // Copy+delete emulation
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
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
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
    if (clientSecret) {
      body.set("client_secret", clientSecret);
    }
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
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    if (!clientId) {
      throw new Error("Microsoft OAuth credentials not configured");
    }

    const params: Record<string, string> = {
      client_id: clientId,
      scope: OUTLOOK_SCOPES.join(" "),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    };
    if (clientSecret) {
      params.client_secret = clientSecret;
    }

    const response = await fetch(MS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
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
  // Read
  // ---------------------------------------------------------------------------

  async getCalendars(accessToken: string): Promise<ApiCalendar[]> {
    const calendars: ApiCalendar[] = [];
    let url: string | undefined = `${MS_GRAPH_URL}/me/calendars`;

    do {
      const response = await graphFetch(url, accessToken);
      if (!response.ok) await handleGraphError(response);

      const data = (await response.json()) as GraphCalendarListResponse;
      for (const cal of data.value) {
        calendars.push(mapGraphCalendar(cal));
      }

      url = data["@odata.nextLink"];
    } while (url);

    return calendars;
  }

  async getEvents(
    accessToken: string,
    calendarId: string,
    options: EventFetchOptions,
  ): Promise<EventFetchResult> {
    const categories = await fetchCategories(accessToken);
    const categoryColorMap = buildCategoryColorMap(categories);

    const events: ApiCalendarEvent[] = [];
    const baseUrl = new URL(
      `${MS_GRAPH_URL}/me/calendars/${encodeURIComponent(calendarId)}/calendarView`,
    );
    baseUrl.searchParams.set("startDateTime", options.timeMin);
    baseUrl.searchParams.set("endDateTime", options.timeMax);
    baseUrl.searchParams.set("$top", "250");

    let url: string | undefined = baseUrl.toString();

    do {
      const response = await graphFetch(url, accessToken, {
        headers: { Prefer: `${GRAPH_PREFER_HEADER}, odata.maxpagesize=250` },
      });
      if (!response.ok) await handleGraphError(response);

      const data = (await response.json()) as GraphEventListResponse;
      for (const graphEvent of data.value) {
        // Skip cancelled events
        if (graphEvent.isCancelled) continue;

        const mapped = mapGraphEvent(
          graphEvent,
          calendarId,
          options.calendarColor,
          options.calendarAccessRole,
          categoryColorMap,
          options.accountEmail,
        );
        if (mapped) events.push(mapped);
      }

      url = data["@odata.nextLink"];
    } while (url);

    return { events };
  }

  async getEventsIncremental(
    accessToken: string,
    calendarId: string,
    syncToken: string,
    options: Pick<EventFetchOptions, "calendarColor" | "calendarAccessRole" | "accountEmail">,
  ): Promise<IncrementalSyncResult> {
    const categories = await fetchCategories(accessToken);
    const categoryColorMap = buildCategoryColorMap(categories);

    const events: ApiCalendarEvent[] = [];
    const cancelledIds: string[] = [];

    // The syncToken IS the deltaLink URL for Outlook
    let url: string | undefined = syncToken;

    do {
      const response = await graphFetch(url, accessToken, {
        headers: { Prefer: `${GRAPH_PREFER_HEADER}, odata.maxpagesize=50` },
      });
      if (!response.ok) await handleGraphError(response);

      const data = (await response.json()) as GraphEventListResponse;

      for (const graphEvent of data.value) {
        // Deleted events have @removed annotation
        if (graphEvent["@removed"]) {
          cancelledIds.push(graphEvent.id);
          continue;
        }

        const mapped = mapGraphEvent(
          graphEvent,
          calendarId,
          options.calendarColor,
          options.calendarAccessRole,
          categoryColorMap,
          options.accountEmail,
        );
        if (mapped) events.push(mapped);
      }

      // Follow nextLink for more pages, or get deltaLink when done
      if (data["@odata.nextLink"]) {
        url = data["@odata.nextLink"];
      } else {
        // Store the deltaLink as the next sync token
        const nextSyncToken = data["@odata.deltaLink"];
        if (!nextSyncToken) {
          throw new ProviderApiError("No deltaLink returned from Outlook delta query", 500);
        }

        return { events, cancelledIds, nextSyncToken };
      }
    } while (url);

    // Unreachable — the loop always returns via deltaLink
    throw new ProviderApiError("Delta query ended without deltaLink", 500);
  }

  async getInitialSyncToken(
    accessToken: string,
    calendarId: string,
    timeMin: string,
    timeMax: string,
  ): Promise<string> {
    // For Outlook, delta sync is date-range-bound. The initial delta query
    // returns all events + a deltaLink. We discard the events (already
    // fetched via getEvents) and just capture the deltaLink.
    const baseUrl = new URL(
      `${MS_GRAPH_URL}/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta`,
    );
    baseUrl.searchParams.set("startDateTime", timeMin);
    baseUrl.searchParams.set("endDateTime", timeMax);

    let url: string | undefined = baseUrl.toString();

    do {
      const response = await graphFetch(url, accessToken, {
        headers: { Prefer: `${GRAPH_PREFER_HEADER}, odata.maxpagesize=250` },
      });
      if (!response.ok) await handleGraphError(response);

      const data = (await response.json()) as GraphEventListResponse;

      if (data["@odata.nextLink"]) {
        url = data["@odata.nextLink"];
      } else if (data["@odata.deltaLink"]) {
        return data["@odata.deltaLink"];
      } else {
        throw new ProviderApiError("No deltaLink in initial delta response", 500);
      }
    } while (url);

    throw new ProviderApiError("Initial delta query ended without deltaLink", 500);
  }

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  async createEvent(
    accessToken: string,
    calendarId: string,
    event: NewProviderEvent,
    options?: MutationOptions,
  ): Promise<ApiCalendarEvent> {
    const body = toOutlookCreateBody(event);

    const response = await graphFetch(
      `${MS_GRAPH_URL}/me/calendars/${encodeURIComponent(calendarId)}/events`,
      accessToken,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: GRAPH_PREFER_HEADER,
          // Idempotency for retries
          "Immutable-Id": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) await handleGraphError(response);

    const created = (await response.json()) as GraphEvent;
    const calendarColor = options?.calendarColor || "#0078d4";
    const result = mapGraphEvent(created, calendarId, calendarColor, options?.calendarAccessRole, undefined, options?.accountEmail);
    if (!result) {
      throw new Error("Failed to map created Outlook event — missing start or end");
    }
    return result;
  }

  async updateEvent(
    accessToken: string,
    _calendarId: string,
    eventId: string,
    patch: ProviderEventPatch,
    options?: MutationOptions,
  ): Promise<ApiCalendarEvent> {
    const body = toOutlookPatchBody(patch);

    const response = await graphFetch(
      `${MS_GRAPH_URL}/me/events/${encodeURIComponent(eventId)}`,
      accessToken,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Prefer: GRAPH_PREFER_HEADER,
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) await handleGraphError(response);

    const updated = (await response.json()) as GraphEvent;
    const calendarColor = options?.calendarColor || "#0078d4";
    const result = mapGraphEvent(updated, _calendarId, calendarColor, options?.calendarAccessRole, undefined, options?.accountEmail);
    if (!result) {
      throw new Error("Failed to map updated Outlook event — missing start or end");
    }
    return result;
  }

  async deleteEvent(
    accessToken: string,
    _calendarId: string,
    eventId: string,
    _options?: MutationOptions,
  ): Promise<void> {
    const response = await graphFetch(
      `${MS_GRAPH_URL}/me/events/${encodeURIComponent(eventId)}`,
      accessToken,
      { method: "DELETE" },
    );

    // 204 No Content = success, 404 = already deleted
    if (response.status === 204 || response.status === 404) return;
    if (!response.ok) await handleGraphError(response);
  }

  async moveEvent(
    accessToken: string,
    _sourceCalId: string,
    eventId: string,
    destCalId: string,
  ): Promise<ApiCalendarEvent> {
    // Outlook has no native move — implement as copy+delete.
    // 1. Read the original event
    const getResponse = await graphFetch(
      `${MS_GRAPH_URL}/me/events/${encodeURIComponent(eventId)}`,
      accessToken,
    );
    if (!getResponse.ok) await handleGraphError(getResponse);
    const original = (await getResponse.json()) as GraphEvent;

    // 2. Create copy in destination calendar
    const createBody: Record<string, unknown> = {
      subject: original.subject,
      body: original.body,
      start: original.start,
      end: original.end,
      isAllDay: original.isAllDay,
      location: original.location,
      attendees: original.attendees,
      showAs: original.showAs,
      sensitivity: original.sensitivity,
      categories: original.categories,
    };

    const createResponse = await graphFetch(
      `${MS_GRAPH_URL}/me/calendars/${encodeURIComponent(destCalId)}/events`,
      accessToken,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: GRAPH_PREFER_HEADER,
        },
        body: JSON.stringify(createBody),
      },
    );
    if (!createResponse.ok) await handleGraphError(createResponse);
    const created = (await createResponse.json()) as GraphEvent;

    // 3. Delete original (best effort — if this fails, user has the event in the new calendar)
    const deleteResponse = await graphFetch(
      `${MS_GRAPH_URL}/me/events/${encodeURIComponent(eventId)}`,
      accessToken,
      { method: "DELETE" },
    );
    if (!deleteResponse.ok && deleteResponse.status !== 204 && deleteResponse.status !== 404) {
      console.error(`[outlook] Failed to delete original event ${eventId} after move — duplicate may exist`);
    }

    const result = mapGraphEvent(created, destCalId, "#0078d4");
    if (!result) {
      throw new Error("Failed to map moved Outlook event — missing start or end");
    }
    return result;
  }

  async rsvpEvent(
    accessToken: string,
    _calendarId: string,
    eventId: string,
    response: RsvpResponse,
    options?: MutationOptions,
  ): Promise<void> {
    // Map our RsvpResponse to the Outlook RSVP endpoint
    const endpointMap: Record<RsvpResponse, string> = {
      accepted: "accept",
      tentative: "tentativelyAccept",
      declined: "decline",
    };
    const action = endpointMap[response];

    // Map sendUpdates to Outlook's sendResponse boolean
    const sendResponse = options?.sendUpdates !== "none";

    const rsvpResponse = await graphFetch(
      `${MS_GRAPH_URL}/me/events/${encodeURIComponent(eventId)}/${action}`,
      accessToken,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: GRAPH_PREFER_HEADER,
        },
        body: JSON.stringify({ sendResponse }),
      },
    );

    // 202 Accepted = success
    if (rsvpResponse.status === 202) return;
    if (!rsvpResponse.ok) await handleGraphError(rsvpResponse);
  }

  // ---------------------------------------------------------------------------
  // Webhooks (Outlook Subscriptions)
  // ---------------------------------------------------------------------------

  async createWatch(
    accessToken: string,
    calendarId: string,
    webhookUrl: string,
    options?: WatchOptions,
  ): Promise<WatchInfo> {
    // Outlook uses subscriptions — max TTL is 10,080 minutes (7 days)
    const ttlMinutes = options?.ttl ? Math.min(Math.floor(options.ttl / 60), 10_080) : 10_080;
    const expirationDate = new Date(Date.now() + ttlMinutes * 60 * 1000);

    const response = await graphFetch(
      `${MS_GRAPH_URL}/subscriptions`,
      accessToken,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: GRAPH_PREFER_HEADER },
        body: JSON.stringify({
          changeType: "created,updated,deleted",
          notificationUrl: webhookUrl,
          lifecycleNotificationUrl: `${webhookUrl}/lifecycle`,
          resource: `/me/calendars/${calendarId}/events`,
          expirationDateTime: expirationDate.toISOString(),
          clientState: options?.token || "",
        }),
      },
    );

    if (!response.ok) await handleGraphError(response);

    const data = (await response.json()) as {
      id: string;
      expirationDateTime: string;
      resource: string;
    };

    return {
      channelId: data.id, // subscription ID
      resourceId: data.resource,
      expiration: new Date(data.expirationDateTime),
    };
  }

  async deleteWatch(
    accessToken: string,
    channelId: string,
    _resourceId?: string,
  ): Promise<void> {
    const response = await graphFetch(
      `${MS_GRAPH_URL}/subscriptions/${encodeURIComponent(channelId)}`,
      accessToken,
      { method: "DELETE" },
    );

    // 204 No Content = success, 404 = already expired/deleted
    if (response.status === 204 || response.status === 404) return;
    if (!response.ok) await handleGraphError(response);
  }

  // ---------------------------------------------------------------------------
  // Contacts (People API)
  // ---------------------------------------------------------------------------

  async searchContacts(accessToken: string, query?: string): Promise<ProviderContact[]> {
    const url = new URL(`${MS_GRAPH_URL}/me/people`);
    url.searchParams.set("$top", "100");
    if (query) {
      url.searchParams.set("$search", `"${query}"`);
    }

    const response = await graphFetch(url.toString(), accessToken);

    // 403 = People.Read scope missing — return empty
    if (response.status === 403) return [];
    if (!response.ok) {
      console.warn("[outlook] Failed to fetch contacts:", response.status);
      return [];
    }

    const data = (await response.json()) as {
      value: {
        displayName?: string;
        scoredEmailAddresses?: { address: string }[];
        givenName?: string;
        surname?: string;
      }[];
    };

    const contacts: ProviderContact[] = [];
    for (const person of data.value) {
      const email = person.scoredEmailAddresses?.[0]?.address?.trim().toLowerCase();
      if (!email) continue;
      contacts.push({
        email,
        name: person.displayName || null,
      });
    }

    return contacts;
  }
}
