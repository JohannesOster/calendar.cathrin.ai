import type { ApiCalendar, ApiCalendarEvent } from "@cathrin/shared-types";
import {
  GoogleCalendarService,
  SyncTokenExpiredError as GoogleSyncTokenExpiredError,
  type GoogleEventPatch,
} from "../../services/google-calendar.js";
import {
  SyncTokenExpiredError,
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

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_PEOPLE_URL =
  "https://people.googleapis.com/v1/people/me/connections";

/**
 * Google Calendar provider implementation.
 * Thin adapter over GoogleCalendarService — delegates API calls,
 * translates between provider-agnostic interface types and Google-specific formats.
 */
export class GoogleCalendarProvider implements CalendarProvider {
  readonly id = "google" as const;
  readonly displayName = "Google Calendar";
  readonly capabilities: ProviderCapabilities = {
    incrementalSync: true,
    webhooks: true,
    moveEvent: true,
    conferenceCreate: true,
  };

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  getAuthUrl(params: AuthUrlParams): string {
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("client_id", params.clientId);
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("scope", params.scopes.join(" "));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    if (params.state) url.searchParams.set("state", params.state);
    return url.toString();
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<TokenPair> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("Google OAuth credentials not configured");
    }

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => response.statusText);
      throw new Error(`Google token exchange failed: ${body}`);
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
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("Google OAuth credentials not configured");
    }

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => response.statusText);
      throw new Error(`Google token refresh failed: ${body}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
    };
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async getCalendars(accessToken: string): Promise<ApiCalendar[]> {
    const service = new GoogleCalendarService(accessToken);
    return service.fetchCalendarList();
  }

  async getEvents(
    accessToken: string,
    calendarId: string,
    options: EventFetchOptions,
  ): Promise<EventFetchResult> {
    const service = new GoogleCalendarService(accessToken);
    const events = await service.fetchEvents(
      calendarId,
      options.timeMin,
      options.timeMax,
      options.calendarColor,
      options.calendarAccessRole,
    );
    return { events };
  }

  async getEventsIncremental(
    accessToken: string,
    calendarId: string,
    syncToken: string,
    options: Pick<EventFetchOptions, "calendarColor" | "calendarAccessRole">,
  ): Promise<IncrementalSyncResult> {
    try {
      const service = new GoogleCalendarService(accessToken);
      return await service.fetchEventsIncremental(
        calendarId,
        syncToken,
        options.calendarColor,
        options.calendarAccessRole,
      );
    } catch (error) {
      // Re-throw as provider-generic error
      if (error instanceof GoogleSyncTokenExpiredError) {
        throw new SyncTokenExpiredError();
      }
      throw error;
    }
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
    const service = new GoogleCalendarService(accessToken);

    // Translate conferencing to Google's conferenceData format
    const wantsMeet = event.conferencing?.type === "create";

    const googleEvent = await service.insertEvent(
      calendarId,
      {
        summary: event.title,
        start: event.isAllDay
          ? { date: event.start.slice(0, 10) }
          : { dateTime: event.start, ...(event.timeZone && { timeZone: event.timeZone }) },
        end: event.isAllDay
          ? { date: event.end.slice(0, 10) }
          : { dateTime: event.end, ...(event.timeZone && { timeZone: event.timeZone }) },
        location: event.location,
        description: event.description,
        transparency: event.transparency,
        visibility: event.visibility,
        ...(event.reminders !== undefined && {
          reminders:
            event.reminders && event.reminders.length > 0
              ? { useDefault: false, overrides: event.reminders }
              : { useDefault: true },
        }),
        colorId: event.colorId,
        ...(wantsMeet && {
          conferenceData: {
            createRequest: {
              requestId: crypto.randomUUID(),
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        }),
        ...(event.attendees &&
          event.attendees.length > 0 && {
            attendees: event.attendees.map((a) => ({
              email: a.email,
              displayName: a.name,
            })),
          }),
      },
      options?.sendUpdates ? { sendUpdates: options.sendUpdates } : undefined,
    );

    const calendarColor = options?.calendarColor || "#4285f4";
    const result = service.mapEvent(
      googleEvent,
      calendarId,
      calendarColor,
      options?.calendarAccessRole,
    );
    if (!result) {
      throw new Error("Failed to map created event — missing start or end date");
    }
    return result;
  }

  async updateEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    patch: ProviderEventPatch,
    options?: MutationOptions,
  ): Promise<ApiCalendarEvent> {
    const googlePatch: GoogleEventPatch = {};
    if (patch.summary !== undefined) googlePatch.summary = patch.summary;
    if (patch.description !== undefined)
      googlePatch.description = patch.description;
    if (patch.location !== undefined) googlePatch.location = patch.location;
    if (patch.transparency !== undefined)
      googlePatch.transparency = patch.transparency;
    if (patch.visibility !== undefined) googlePatch.visibility = patch.visibility;
    if (patch.reminders !== undefined) {
      googlePatch.reminders = {
        useDefault: false,
        overrides:
          patch.reminders && patch.reminders.length > 0 ? patch.reminders : [],
      };
    }
    if (patch.colorId !== undefined) googlePatch.colorId = patch.colorId ?? null;

    // Translate conferencing to Google's conferenceData format
    if (patch.conferencing !== undefined) {
      if (patch.conferencing === null) {
        googlePatch.conferenceData = null;
      } else if (patch.conferencing.type === "create") {
        googlePatch.conferenceData = {
          createRequest: {
            requestId: crypto.randomUUID(),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        };
      }
      // "manual" URIs don't go through Google's conferenceData — stored locally
    }

    if (patch.attendees !== undefined) {
      googlePatch.attendees = patch.attendees
        ? patch.attendees.map((a) => ({ email: a.email }))
        : [];
    }

    // Google deep-merges nested objects, so switching between all-day and timed
    // formats requires explicitly nulling the other field.
    const useDate = patch.isAllDay ?? false;
    const tz = !useDate ? patch.timeZone : undefined;
    if (patch.start !== undefined) {
      googlePatch.start = useDate
        ? { date: patch.start.slice(0, 10), dateTime: null }
        : { dateTime: patch.start, date: null, ...(tz && { timeZone: tz }) };
    }
    if (patch.end !== undefined) {
      googlePatch.end = useDate
        ? { date: patch.end.slice(0, 10), dateTime: null }
        : { dateTime: patch.end, date: null, ...(tz && { timeZone: tz }) };
    }

    const service = new GoogleCalendarService(accessToken);
    const updated = await service.patchEvent(
      calendarId,
      eventId,
      googlePatch,
      options?.sendUpdates ? { sendUpdates: options.sendUpdates } : undefined,
    );

    const calendarColor = options?.calendarColor || "#4285f4";
    const result = service.mapEvent(
      updated,
      calendarId,
      calendarColor,
      options?.calendarAccessRole,
    );
    if (!result) {
      throw new Error("Failed to map updated event — missing start or end date");
    }
    return result;
  }

  async deleteEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    options?: MutationOptions,
  ): Promise<void> {
    const service = new GoogleCalendarService(accessToken);
    await service.deleteEvent(
      calendarId,
      eventId,
      options?.sendUpdates ? { sendUpdates: options.sendUpdates } : undefined,
    );
  }

  async moveEvent(
    accessToken: string,
    sourceCalId: string,
    eventId: string,
    destCalId: string,
  ): Promise<ApiCalendarEvent> {
    const service = new GoogleCalendarService(accessToken);
    const moved = await service.moveEvent(sourceCalId, eventId, destCalId);
    // Caller updates with actual calendar color after DB operations
    const result = service.mapEvent(moved, destCalId, "#4285f4");
    if (!result) {
      throw new Error("Failed to map moved event — missing start or end date");
    }
    return result;
  }

  async rsvpEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    response: RsvpResponse,
    options?: MutationOptions,
  ): Promise<void> {
    // Google RSVP works by patching the attendees array with updated responseStatus
    const attendees = options?.currentAttendees;
    if (!attendees || attendees.length === 0) {
      throw new Error("Google RSVP requires currentAttendees in options");
    }

    const googleAttendees = attendees.map((a) => ({
      email: a.email,
      responseStatus: a.isSelf ? response : a.responseStatus,
      ...(a.isOrganizer && { organizer: true }),
      ...(a.isSelf && { self: true }),
    }));

    const service = new GoogleCalendarService(accessToken);
    await service.patchEvent(
      calendarId,
      eventId,
      { attendees: googleAttendees },
      { sendUpdates: options?.sendUpdates ?? "none" },
    );
  }

  // ---------------------------------------------------------------------------
  // Webhooks
  // ---------------------------------------------------------------------------

  async createWatch(
    accessToken: string,
    calendarId: string,
    webhookUrl: string,
    options?: WatchOptions,
  ): Promise<WatchInfo> {
    const channelId = crypto.randomUUID();

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/watch`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: channelId,
          type: "web_hook",
          address: webhookUrl,
          ...(options?.token && { token: options.token }),
          ...(options?.ttl && { params: { ttl: String(options.ttl) } }),
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => response.statusText);
      throw new Error(
        `Failed to create Google watch channel: ${response.status} ${body}`,
      );
    }

    const data = (await response.json()) as {
      id: string;
      resourceId: string;
      expiration: string;
    };

    return {
      channelId: data.id,
      resourceId: data.resourceId,
      expiration: new Date(Number(data.expiration)),
    };
  }

  async deleteWatch(
    accessToken: string,
    channelId: string,
    resourceId?: string,
  ): Promise<void> {
    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/channels/stop",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: channelId, resourceId }),
      },
    );

    // 404 = channel already expired, treat as success
    if (!response.ok && response.status !== 404) {
      throw new Error(
        `Failed to stop Google watch channel: ${response.status}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Contacts
  // ---------------------------------------------------------------------------

  async searchContacts(accessToken: string): Promise<ProviderContact[]> {
    const contacts: ProviderContact[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(GOOGLE_PEOPLE_URL);
      url.searchParams.set("personFields", "names,emailAddresses");
      url.searchParams.set("pageSize", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      // 403 = missing contacts.readonly scope — return what we have
      if (response.status === 403) return contacts;

      if (!response.ok) {
        throw new Error(`Google People API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        connections?: {
          names?: { displayName?: string }[];
          emailAddresses?: { value?: string }[];
        }[];
        nextPageToken?: string;
      };

      for (const person of data.connections || []) {
        const name = person.names?.[0]?.displayName || null;
        for (const emailEntry of person.emailAddresses || []) {
          const email = emailEntry.value?.trim().toLowerCase();
          if (email) contacts.push({ email, name });
        }
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    return contacts;
  }
}
