/**
 * Microsoft Graph API response types for Outlook Calendar.
 * These are internal to the Outlook provider — not exported to consumers.
 */

// === Calendar ===

export interface GraphCalendar {
  id: string;
  name: string;
  color: string; // "auto" | preset name like "lightBlue", "lightGreen", etc.
  isDefaultCalendar: boolean;
  canEdit: boolean;
  canViewPrivateItems: boolean;
  owner?: { name: string; address: string };
}

export interface GraphCalendarListResponse {
  value: GraphCalendar[];
  "@odata.nextLink"?: string;
}

// === Events ===

export interface GraphDateTimeTimeZone {
  dateTime: string; // e.g. "2024-12-09T20:30:00.0000000"
  timeZone: string; // e.g. "UTC", "Pacific Standard Time"
}

export interface GraphAttendee {
  emailAddress: { address: string; name: string };
  type: "required" | "optional" | "resource";
  status: {
    response: "none" | "organizer" | "tentativelyAccepted" | "accepted" | "declined" | "notResponded";
    time: string;
  };
}

export interface GraphEvent {
  id: string;
  subject: string;
  body?: { contentType: string; content: string };
  start: GraphDateTimeTimeZone;
  end: GraphDateTimeTimeZone;
  isAllDay: boolean;
  location?: { displayName: string; locationType?: string };
  attendees?: GraphAttendee[];
  organizer?: { emailAddress: { address: string; name: string } };
  showAs?: "free" | "tentative" | "busy" | "oof" | "workingElsewhere" | "unknown";
  sensitivity?: "normal" | "personal" | "private" | "confidential";
  categories?: string[];
  onlineMeeting?: { joinUrl: string };
  onlineMeetingProvider?: string;
  responseStatus?: {
    response: "none" | "organizer" | "tentativelyAccepted" | "accepted" | "declined" | "notResponded";
    time: string;
  };
  iCalUId?: string;
  type?: "singleInstance" | "occurrence" | "exception" | "seriesMaster";
  seriesMasterId?: string;
  recurrence?: GraphRecurrence;
  isCancelled?: boolean;
  // Delta sync annotation for deleted events
  "@removed"?: { reason: string };
}

export interface GraphEventListResponse {
  value: GraphEvent[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

// === Categories (for color mapping) ===

export interface GraphCategory {
  displayName: string;
  color: string; // preset name: "preset0" through "preset24", or "none"
}

export interface GraphCategoryListResponse {
  value: GraphCategory[];
}

// === Recurrence ===

export interface GraphRecurrencePattern {
  type: "daily" | "weekly" | "absoluteMonthly" | "relativeMonthly" | "absoluteYearly" | "relativeYearly";
  interval: number;
  daysOfWeek?: string[];
  dayOfMonth?: number;
  month?: number;
  firstDayOfWeek?: string;
  index?: "first" | "second" | "third" | "fourth" | "last";
}

export interface GraphRecurrenceRange {
  type: "endDate" | "noEnd" | "numbered";
  startDate: string; // yyyy-MM-dd
  endDate?: string;  // yyyy-MM-dd
  numberOfOccurrences?: number;
  recurrenceTimeZone?: string;
}

export interface GraphRecurrence {
  pattern: GraphRecurrencePattern;
  range: GraphRecurrenceRange;
}

// === Error ===

export interface GraphErrorResponse {
  error: {
    code: string;
    message: string;
    innerError?: { code?: string };
  };
}
