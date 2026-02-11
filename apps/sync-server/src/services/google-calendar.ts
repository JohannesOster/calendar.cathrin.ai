import type { ApiCalendar, ApiCalendarEvent } from "@cathrin/shared-types";

const GOOGLE_CALENDAR_LIST_URL =
  "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const GOOGLE_CALENDAR_EVENTS_URL =
  "https://www.googleapis.com/calendar/v3/calendars";

/**
 * Error thrown when access token is expired or invalid
 */
export class TokenExpiredError extends Error {
  constructor() {
    super("Access token expired");
    this.name = "TokenExpiredError";
  }
}

/**
 * Error thrown when sync token is expired (410 Gone)
 */
export class SyncTokenExpiredError extends Error {
  constructor() {
    super("Sync token expired - full sync required");
    this.name = "SyncTokenExpiredError";
  }
}

/**
 * Error thrown for other Google API errors
 */
export class GoogleApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

// Google API response types
interface GoogleCalendar {
  id: string;
  summary: string;
  description?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  primary?: boolean;
  accessRole?: string;
}

interface CalendarListResponse {
  kind: string;
  etag: string;
  items?: GoogleCalendar[];
  nextPageToken?: string;
}

interface EventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

interface GoogleEvent {
  id: string;
  summary?: string;
  start: EventDateTime;
  end: EventDateTime;
  colorId?: string;
  status?: string;
  location?: string;
  description?: string;
  guestsCanModify?: boolean;
  locked?: boolean;
  organizer?: { self?: boolean };
}

interface EventsListResponse {
  kind: string;
  etag: string;
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

/**
 * Patch body for Google Calendar PATCH endpoint.
 * Date fields include a null counterpart because Google deep-merges nested
 * objects, so switching between date/dateTime requires explicitly nulling
 * the other field.
 */
export interface GoogleEventPatch {
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime: string; date?: null } | { date: string; dateTime?: null };
  end?: { dateTime: string; date?: null } | { date: string; dateTime?: null };
}

/**
 * Google Calendar API client service
 *
 * Fetches calendars and events from Google's Calendar API using OAuth access tokens.
 */
export class GoogleCalendarService {
  constructor(private accessToken: string) {}

  /**
   * Fetch all calendars for the authenticated user
   */
  async fetchCalendarList(): Promise<ApiCalendar[]> {
    const allCalendars: GoogleCalendar[] = [];
    let pageToken: string | undefined;

    do {
      const url = new URL(GOOGLE_CALENDAR_LIST_URL);
      url.searchParams.set("maxResults", "250");
      url.searchParams.set("minAccessRole", "reader");
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      await this.handleErrorResponse(response);

      const data = (await response.json()) as CalendarListResponse;
      if (data.items) {
        allCalendars.push(...data.items);
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    return allCalendars.map((cal) => this.mapCalendar(cal));
  }

  /**
   * Fetch events for a calendar within a time range
   */
  async fetchEvents(
    calendarId: string,
    timeMin: string,
    timeMax: string,
    calendarColor: string,
    calendarAccessRole?: string
  ): Promise<ApiCalendarEvent[]> {
    const allEvents: GoogleEvent[] = [];
    let pageToken: string | undefined;

    const baseUrl = `${GOOGLE_CALENDAR_EVENTS_URL}/${encodeURIComponent(calendarId)}/events`;

    do {
      const url = new URL(baseUrl);
      url.searchParams.set("timeMin", timeMin);
      url.searchParams.set("timeMax", timeMax);
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("maxResults", "2500");
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      await this.handleErrorResponse(response);

      const data = (await response.json()) as EventsListResponse;
      if (data.items) {
        // Filter out cancelled events
        const activeEvents = data.items.filter(
          (event) => event.status !== "cancelled"
        );
        allEvents.push(...activeEvents);
      }

      pageToken = data.nextPageToken;
    } while (pageToken);

    return allEvents
      .map((event) => this.mapEvent(event, calendarId, calendarColor, calendarAccessRole))
      .filter((e): e is ApiCalendarEvent => e !== null);
  }

  /**
   * Fetch events incrementally using a sync token
   */
  async fetchEventsIncremental(
    calendarId: string,
    syncToken: string,
    calendarColor: string,
    calendarAccessRole?: string
  ): Promise<{
    events: ApiCalendarEvent[];
    cancelledIds: string[];
    nextSyncToken: string;
  }> {
    const allEvents: GoogleEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;

    const baseUrl = `${GOOGLE_CALENDAR_EVENTS_URL}/${encodeURIComponent(calendarId)}/events`;

    do {
      const url = new URL(baseUrl);
      url.searchParams.set("syncToken", syncToken);
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      // Handle 410 Gone - sync token expired
      if (response.status === 410) {
        throw new SyncTokenExpiredError();
      }

      await this.handleErrorResponse(response);

      const data = (await response.json()) as EventsListResponse;
      if (data.items) {
        allEvents.push(...data.items);
      }

      pageToken = data.nextPageToken;
      nextSyncToken = data.nextSyncToken;
    } while (pageToken);

    if (!nextSyncToken) {
      throw new GoogleApiError("No sync token returned", 500);
    }

    // Separate cancelled (deleted) events from active ones.
    // Cancelled IDs are returned so the caller can delete them from storage.
    const cancelledIds = allEvents
      .filter((e) => e.status === "cancelled")
      .map((e) => e.id);
    const activeEvents = allEvents.filter((e) => e.status !== "cancelled");

    return {
      events: activeEvents
        .map((event) => this.mapEvent(event, calendarId, calendarColor, calendarAccessRole))
        .filter((e): e is ApiCalendarEvent => e !== null),
      cancelledIds,
      nextSyncToken,
    };
  }

  /**
   * Create an event in a Google Calendar
   */
  async insertEvent(
    calendarId: string,
    event: {
      summary: string;
      start: { dateTime?: string; date?: string };
      end: { dateTime?: string; date?: string };
      location?: string;
      description?: string;
    }
  ): Promise<GoogleEvent> {
    const url = `${GOOGLE_CALENDAR_EVENTS_URL}/${encodeURIComponent(calendarId)}/events`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });

    await this.handleErrorResponse(response);

    return (await response.json()) as GoogleEvent;
  }

  /**
   * Patch (partial update) an event in a Google Calendar
   *
   * Google PATCH deep-merges nested objects. When switching between all-day
   * and timed formats, the caller must null-out the conflicting field
   * (e.g., { date: "2025-01-01", dateTime: null }) so Google clears it.
   */
  async patchEvent(
    calendarId: string,
    eventId: string,
    patch: GoogleEventPatch
  ): Promise<GoogleEvent> {
    const url = `${GOOGLE_CALENDAR_EVENTS_URL}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patch),
    });

    await this.handleErrorResponse(response);

    return (await response.json()) as GoogleEvent;
  }

  /**
   * Delete an event from a Google Calendar
   */
  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    const url = `${GOOGLE_CALENDAR_EVENTS_URL}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    // 204 No Content and 410 Gone are both success (already deleted)
    if (response.status === 204 || response.status === 410) {
      return;
    }

    await this.handleErrorResponse(response);
  }

  /**
   * Handle non-2xx responses
   */
  private async handleErrorResponse(response: Response): Promise<void> {
    if (response.status === 401) {
      throw new TokenExpiredError();
    }

    if (response.status === 429) {
      throw new GoogleApiError("Rate limit exceeded", 429);
    }

    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = await response.json() as { error?: { message?: string } };
        detail = body?.error?.message || JSON.stringify(body);
      } catch {
        // Fall back to statusText
      }
      throw new GoogleApiError(
        `Google API error: ${detail}`,
        response.status
      );
    }
  }

  /**
   * Map Google calendar to ApiCalendar
   */
  private mapCalendar(calendar: GoogleCalendar): ApiCalendar {
    return {
      id: calendar.id,
      accountId: "", // Will be filled in by the caller
      name: calendar.summary,
      color: calendar.backgroundColor ?? "#4285f4",
      visible: true, // Default to visible, will be user preference later
      provider: "google",
      accessRole: calendar.accessRole,
    };
  }

  /**
   * Map Google event to ApiCalendarEvent.
   * Returns null if the event has no start or end date (skipped with a warning).
   *
   * Computes `isReadOnly` from calendar-level `accessRole` and event-level
   * permission fields (`guestsCanModify`, `locked`, `organizer.self`).
   */
  private mapEvent(
    event: GoogleEvent,
    calendarId: string,
    calendarColor: string,
    calendarAccessRole?: string
  ): ApiCalendarEvent | null {
    const start = event.start.dateTime || event.start.date;
    const end = event.end.dateTime || event.end.date;

    if (!start || !end) {
      console.warn(
        `[google-calendar] Skipping event "${event.id}" — missing ${!start ? "start" : "end"} date`
      );
      return null;
    }

    const { isReadOnly, readOnlyReason } = this.computeReadOnly(
      calendarAccessRole,
      event
    );

    return {
      id: event.id,
      calendarId,
      title: event.summary || "(No title)",
      start,
      end,
      isAllDay: !!event.start.date,
      color: calendarColor,
      provider: "google",
      location: event.location || undefined,
      description: event.description || undefined,
      isReadOnly,
      readOnlyReason,
    };
  }

  /**
   * Derive isReadOnly + reason from calendar access role and event fields.
   * Priority: calendar_read_only > locked > not_organizer
   * Defaults to editable when permission data is unavailable.
   */
  private computeReadOnly(
    calendarAccessRole: string | undefined,
    event: GoogleEvent
  ): { isReadOnly: boolean; readOnlyReason?: string } {
    if (calendarAccessRole === "reader" || calendarAccessRole === "freeBusyReader") {
      return { isReadOnly: true, readOnlyReason: "calendar_read_only" };
    }

    if (event.locked) {
      return { isReadOnly: true, readOnlyReason: "locked" };
    }

    if (!event.organizer?.self && !event.guestsCanModify) {
      return { isReadOnly: true, readOnlyReason: "not_organizer" };
    }

    return { isReadOnly: false };
  }
}
