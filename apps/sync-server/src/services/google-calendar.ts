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
}

interface EventsListResponse {
  kind: string;
  etag: string;
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
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

      this.handleErrorResponse(response);

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
    calendarColor: string
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

      this.handleErrorResponse(response);

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

    return allEvents.map((event) =>
      this.mapEvent(event, calendarId, calendarColor)
    );
  }

  /**
   * Fetch events incrementally using a sync token
   */
  async fetchEventsIncremental(
    calendarId: string,
    syncToken: string,
    calendarColor: string
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

      this.handleErrorResponse(response);

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
      events: activeEvents.map((event) =>
        this.mapEvent(event, calendarId, calendarColor)
      ),
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

    this.handleErrorResponse(response);

    return (await response.json()) as GoogleEvent;
  }

  /**
   * Patch (partial update) an event in a Google Calendar
   */
  async patchEvent(
    calendarId: string,
    eventId: string,
    patch: {
      summary?: string;
      description?: string;
      location?: string;
      start?: { dateTime: string };
      end?: { dateTime: string };
    }
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

    this.handleErrorResponse(response);

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

    this.handleErrorResponse(response);
  }

  /**
   * Handle non-2xx responses
   */
  private handleErrorResponse(response: Response): void {
    if (response.status === 401) {
      throw new TokenExpiredError();
    }

    if (response.status === 429) {
      throw new GoogleApiError("Rate limit exceeded", 429);
    }

    if (!response.ok) {
      throw new GoogleApiError(
        `Google API error: ${response.statusText}`,
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
    };
  }

  /**
   * Map Google event to ApiCalendarEvent
   */
  private mapEvent(
    event: GoogleEvent,
    calendarId: string,
    calendarColor: string
  ): ApiCalendarEvent {
    return {
      id: event.id,
      calendarId,
      title: event.summary || "(No title)",
      start: event.start.dateTime || event.start.date || "",
      end: event.end.dateTime || event.end.date || "",
      isAllDay: !!event.start.date,
      color: calendarColor,
      provider: "google",
      location: event.location || undefined,
      description: event.description || undefined,
    };
  }
}
