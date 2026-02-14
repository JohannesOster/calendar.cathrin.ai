import type { Provider, ApiCalendar, ApiCalendarEvent, Attendee } from "@cathrin/shared-types";

// === Provider Errors ===

/**
 * Thrown when a sync/delta token has expired and a full resync is required.
 * Provider-agnostic — each provider adapter catches its API-specific
 * equivalent (e.g., Google 410 Gone) and re-throws this.
 */
export class SyncTokenExpiredError extends Error {
  constructor(message = "Sync token expired - full sync required") {
    super(message);
    this.name = "SyncTokenExpiredError";
  }
}

/**
 * Thrown when the access token is expired or invalid.
 * Provider-agnostic — each provider adapter catches its API-specific
 * equivalent (e.g., Google 401) and re-throws this.
 */
export class TokenExpiredError extends Error {
  constructor(message = "Access token expired") {
    super(message);
    this.name = "TokenExpiredError";
  }
}

/**
 * Thrown when the refresh token has been revoked or invalidated.
 * The user must re-authorize. Provider-agnostic — each provider detects
 * its specific revocation signal (e.g., Google "invalid_grant",
 * Outlook "invalid_grant" / "interaction_required") and throws this.
 */
export class TokenRevokedError extends Error {
  constructor(message = "User must re-authorize") {
    super(message);
    this.name = "TokenRevokedError";
  }
}

/**
 * Thrown for provider API errors that should be forwarded to the client.
 * Wraps provider-specific error shapes (e.g., Google GoogleApiError,
 * Outlook Graph API errors) into a uniform type.
 */
export class ProviderApiError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ProviderApiError";
    this.statusCode = statusCode;
  }
}

// === Auth ===

export interface AuthUrlParams {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state?: string;
  /** PKCE code challenge (used by Outlook/Azure AD) */
  codeChallenge?: string;
  codeChallengeMethod?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

// === Event Fetching ===

export interface EventFetchOptions {
  timeMin: string;
  timeMax: string;
  calendarColor: string;
  calendarAccessRole?: string;
}

export interface EventFetchResult {
  events: ApiCalendarEvent[];
}

/**
 * Result of an incremental (delta) sync.
 *
 * Google: Uses unbounded syncToken per calendar.
 * Outlook: Uses date-range-bound deltaToken on calendarView.
 */
export interface IncrementalSyncResult {
  events: ApiCalendarEvent[];
  cancelledIds: string[];
  nextSyncToken: string;
}

// === Event Mutation ===

export interface NewProviderEvent {
  title: string;
  start: string;
  end: string;
  isAllDay?: boolean;
  location?: string;
  description?: string;
  transparency?: string;
  visibility?: string;
  reminders?: { method: string; minutes: number }[];
  colorId?: string;
  /** "create" asks provider to create a conference (Meet/Teams), "manual" uses provided URI */
  conferencing?: { type: "create" } | { type: "manual"; uri: string } | null;
  attendees?: { email: string; name?: string }[];
  timeZone?: string;
}

export interface ProviderEventPatch {
  summary?: string;
  description?: string;
  location?: string;
  start?: string;
  end?: string;
  isAllDay?: boolean;
  transparency?: string;
  visibility?: string;
  reminders?: { method: string; minutes: number }[] | null;
  colorId?: string | null;
  /** "create" asks provider to create a conference, null removes it, "manual" is local-only */
  conferencing?: { type: "create" } | { type: "manual"; uri: string } | null;
  attendees?: { email: string; name?: string }[] | null;
  timeZone?: string;
}

export type RsvpResponse = "accepted" | "declined" | "tentative";

export interface MutationOptions {
  sendUpdates?: "all" | "externalOnly" | "none";
  /** Current attendees — needed by providers that RSVP via attendee patching (Google) */
  currentAttendees?: Attendee[];
  /** Calendar color for mapping provider responses to ApiCalendarEvent */
  calendarColor?: string;
  /** Calendar access role for computing isReadOnly */
  calendarAccessRole?: string;
}

// === Webhooks ===

export interface WatchOptions {
  /** TTL in seconds */
  ttl?: number;
  /** Opaque token passed back on notifications (e.g., accountId+calendarId) */
  token?: string;
}

export interface WatchInfo {
  channelId: string;
  resourceId: string;
  expiration: Date;
}

// === Contacts ===

export interface ProviderContact {
  email: string;
  name: string | null;
}

// === Capabilities ===

export interface ProviderCapabilities {
  incrementalSync: boolean;
  webhooks: boolean;
  moveEvent: boolean;
  conferenceCreate: boolean;
}

// === The Interface ===

/**
 * Abstract interface for calendar provider operations.
 * Each provider (Google, Outlook, CalDAV) implements this interface
 * to normalize their API-specific behavior.
 *
 * Design notes for future providers:
 * - Outlook delta sync is calendarView-scoped (date-range bound),
 *   unlike Google's unbounded syncToken
 * - Outlook RSVP uses dedicated /accept, /decline, /tentativelyAccept
 *   endpoints, not attendee patches
 * - Outlook event IDs are mutable by default (need Prefer: IdType="ImmutableId")
 * - Outlook move = copy+delete (no native move endpoint)
 */
export interface CalendarProvider {
  readonly id: Provider;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;

  // --- Auth ---
  getAuthUrl(params: AuthUrlParams): string;
  exchangeCode(code: string, redirectUri: string, codeVerifier?: string): Promise<TokenPair>;
  refreshToken(refreshToken: string): Promise<TokenPair>;

  // --- Read ---
  getCalendars(accessToken: string): Promise<ApiCalendar[]>;
  getEvents(accessToken: string, calendarId: string, options: EventFetchOptions): Promise<EventFetchResult>;
  getEventsIncremental(
    accessToken: string,
    calendarId: string,
    syncToken: string,
    options: Pick<EventFetchOptions, "calendarColor" | "calendarAccessRole">
  ): Promise<IncrementalSyncResult>;

  /**
   * Obtain an initial sync token for a calendar after a full sync.
   * Google: makes a small request to get nextSyncToken.
   * Outlook: makes a delta query with time range, discards events, returns deltaLink.
   */
  getInitialSyncToken(
    accessToken: string,
    calendarId: string,
    timeMin: string,
    timeMax: string,
  ): Promise<string>;

  // --- Write ---
  createEvent(accessToken: string, calendarId: string, event: NewProviderEvent, options?: MutationOptions): Promise<ApiCalendarEvent>;
  updateEvent(accessToken: string, calendarId: string, eventId: string, patch: ProviderEventPatch, options?: MutationOptions): Promise<ApiCalendarEvent>;
  deleteEvent(accessToken: string, calendarId: string, eventId: string, options?: MutationOptions): Promise<void>;
  moveEvent?(accessToken: string, sourceCalId: string, eventId: string, destCalId: string): Promise<ApiCalendarEvent>;
  rsvpEvent(accessToken: string, calendarId: string, eventId: string, response: RsvpResponse, options?: MutationOptions): Promise<void>;

  // --- Webhooks (optional) ---
  createWatch?(accessToken: string, calendarId: string, webhookUrl: string, options?: WatchOptions): Promise<WatchInfo>;
  deleteWatch?(accessToken: string, channelId: string, resourceId?: string): Promise<void>;

  // --- Contacts (optional) ---
  searchContacts?(accessToken: string, query?: string): Promise<ProviderContact[]>;
}
