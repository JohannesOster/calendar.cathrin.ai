/**
 * Mappers between Microsoft Graph API types and normalized Cathrin types.
 */

import type { ApiCalendar, ApiCalendarEvent, Attendee } from "@cathrin/shared-types";
import type { NewProviderEvent, ProviderEventPatch } from "../types.js";
import type { GraphCalendar, GraphEvent, GraphCategory, GraphDateTimeTimeZone } from "./types.js";
import { findIana } from "windows-iana";

// =============================================================================
// Color mapping
// =============================================================================

/**
 * Map Outlook preset calendar colors to hex.
 * Outlook returns color names like "auto", "lightBlue", etc.
 */
const CALENDAR_COLOR_MAP: Record<string, string> = {
  auto: "#0078d4",
  lightBlue: "#69afe5",
  lightGreen: "#7bd148",
  lightOrange: "#ffb878",
  lightGray: "#b3b3b3",
  lightYellow: "#fbd75b",
  lightTeal: "#46d6db",
  lightPink: "#e1a0c1",
  lightBrown: "#c2956a",
  lightRed: "#ff887c",
  maxColor: "#0078d4",
};

/**
 * Map Outlook category preset colors to hex.
 * Categories use "preset0" through "preset24".
 */
const CATEGORY_PRESET_MAP: Record<string, string> = {
  preset0: "#e74856",  // Red
  preset1: "#ff8c00",  // Orange
  preset2: "#f7b32b",  // Brown / Peach
  preset3: "#fff100",  // Yellow
  preset4: "#47b27c",  // Green
  preset5: "#31b0a0",  // Teal
  preset6: "#73aa24",  // Olive
  preset7: "#0078d4",  // Blue
  preset8: "#7160e8",  // Purple
  preset9: "#b4009e",  // Cranberry
  preset10: "#5d5a58", // Steel
  preset11: "#636361", // Dark Steel
  preset12: "#a0a0a0", // Gray
  preset13: "#004b1c", // Dark Green
  preset14: "#004e8c", // Dark Blue
  preset15: "#3b0071", // Dark Purple
  preset16: "#8d0035", // Dark Cranberry
  preset17: "#795548", // Dark Brown
  preset18: "#666666", // Dark Gray
  preset19: "#e3008c", // Magenta
  preset20: "#d13438", // Dark Red
  preset21: "#c19c00", // Dark Yellow
  preset22: "#107c10", // Forest
  preset23: "#009e49", // Emerald
  preset24: "#00188f", // Navy
  none: "#0078d4",
};

/**
 * Build a color lookup from category display name → hex color.
 */
export function buildCategoryColorMap(
  categories: GraphCategory[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const cat of categories) {
    const hex = CATEGORY_PRESET_MAP[cat.color] || CATEGORY_PRESET_MAP.none;
    map.set(cat.displayName, hex);
  }
  return map;
}

// =============================================================================
// Calendar mapping
// =============================================================================

export function mapGraphCalendar(cal: GraphCalendar): ApiCalendar {
  return {
    id: cal.id,
    accountId: "", // Filled in by caller
    name: cal.name,
    color: CALENDAR_COLOR_MAP[cal.color] || CALENDAR_COLOR_MAP.auto,
    visible: true,
    provider: "outlook",
    accessRole: cal.canEdit ? "writer" : "reader",
    canCreateConference: cal.allowedOnlineMeetingProviders?.includes("teamsForBusiness") ?? false,
  };
}

// =============================================================================
// Event mapping
// =============================================================================

/**
 * Convert an Outlook DateTimeTimeZone to a UTC ISO 8601 string.
 *
 * Outlook returns datetimes like "2024-12-09T20:30:00.0000000" with a
 * separate timeZone field. The datetime is local to that timezone, so we
 * must convert it to UTC before returning.
 */
function toIso(dt: { dateTime: string; timeZone: string }): string {
  // Trim sub-second precision beyond 3 digits and any trailing zeros
  const cleaned = dt.dateTime.replace(/\.(\d{3})\d*/, ".$1").replace(/\.000$/, "");
  if (dt.timeZone === "UTC" || dt.timeZone === "tzone://Microsoft/Utc") {
    return cleaned.endsWith("Z") ? cleaned : cleaned + "Z";
  }
  // Convert local time in the given timezone to UTC.
  // Parse the local datetime components and use the timezone to compute UTC.
  const localDate = new Date(cleaned + "Z"); // parse as if UTC to get the numeric components
  // Get the UTC offset for this timezone at this time by comparing formatted local time
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: dt.timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(localDate);
  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? "0", 10);
  const formattedAsLocal = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  // The offset is the difference between what we fed in (as UTC) and what it looks like in the target tz
  const offsetMs = formattedAsLocal - localDate.getTime();
  // The actual datetime in the tz is `cleaned`, which represents local time.
  // To get UTC: parse `cleaned` as components, build a UTC timestamp, then subtract the offset.
  const utcDate = new Date(localDate.getTime() - offsetMs);
  return utcDate.toISOString().replace(/\.000Z$/, "Z");
}

/**
 * Map Outlook attendee response status to our normalized format.
 */
function mapResponseStatus(response: string): Attendee["responseStatus"] {
  switch (response) {
    case "accepted":
    case "organizer":
      return "accepted";
    case "tentativelyAccepted":
      return "tentative";
    case "declined":
      return "declined";
    default:
      return "needsAction";
  }
}

/**
 * Map a Graph event to an ApiCalendarEvent.
 * Returns null if the event has no usable start/end.
 */
export function mapGraphEvent(
  event: GraphEvent,
  calendarId: string,
  calendarColor: string,
  calendarAccessRole?: string,
  categoryColorMap?: Map<string, string>,
  accountEmail?: string,
): ApiCalendarEvent | null {
  const start = toIso(event.start);
  const end = toIso(event.end);

  if (!start || !end) {
    console.warn(`[outlook] Skipping event "${event.id}" — missing start or end`);
    return null;
  }

  const isReadOnly = calendarAccessRole === "reader";

  // Resolve event color from first category
  let eventColor = calendarColor;
  if (event.categories?.length && categoryColorMap) {
    const catColor = categoryColorMap.get(event.categories[0]);
    if (catColor) eventColor = catColor;
  }

  // Map attendees, filtering out resource rooms
  const attendees: Attendee[] | undefined = event.attendees
    ?.filter(a => a.type !== "resource")
    .map(a => ({
      email: a.emailAddress.address,
      name: a.emailAddress.name || undefined,
      responseStatus: mapResponseStatus(a.status.response),
      isOrganizer: event.organizer?.emailAddress.address === a.emailAddress.address || undefined,
      isSelf: accountEmail
        ? a.emailAddress.address.toLowerCase() === accountEmail.toLowerCase() || undefined
        : undefined,
    }));

  // Detect conferencing from Teams/online meeting
  const conferencing = event.onlineMeeting?.joinUrl
    ? { uri: event.onlineMeeting.joinUrl, label: "Microsoft Teams" }
    : undefined;

  // Map visibility from sensitivity
  let visibility: string | undefined;
  if (event.sensitivity === "private" || event.sensitivity === "confidential") {
    visibility = "private";
  }

  // Map transparency from showAs
  const transparency = event.showAs === "free" ? "transparent" : "opaque";

  // Convert Windows timezone names (e.g. "Pacific Standard Time") to IANA (e.g. "America/Los_Angeles")
  let timeZone: string | undefined;
  if (event.start.timeZone !== "UTC" && event.start.timeZone !== "tzone://Microsoft/Utc") {
    const ianaMatches = findIana(event.start.timeZone);
    if (ianaMatches.length > 0) {
      timeZone = ianaMatches[0];
    } else {
      console.warn(`[outlook] Unknown Windows timezone: "${event.start.timeZone}", passing through as-is`);
      timeZone = event.start.timeZone;
    }
  }

  return {
    id: event.id,
    calendarId,
    title: event.subject || "(No title)",
    start,
    end,
    isAllDay: event.isAllDay,
    color: eventColor,
    provider: "outlook",
    location: event.location?.displayName || undefined,
    description: event.body?.content || undefined,
    isReadOnly,
    readOnlyReason: isReadOnly ? "calendar_read_only" : undefined,
    transparency,
    visibility,
    conferencing,
    timeZone,
    attendees: attendees && attendees.length > 0 ? attendees : undefined,
    icalUid: event.iCalUId || undefined,
    recurringEventId: event.seriesMasterId || undefined,
  };
}

// =============================================================================
// Reverse mapping (Cathrin → Outlook Graph API format)
// =============================================================================

/**
 * Convert an ISO 8601 string to Outlook DateTimeTimeZone format.
 *
 * Outlook's DateTimeTimeZone interprets the `dateTime` field as a local time
 * in the specified `timeZone`. So if we receive a UTC ISO string and the
 * caller wants a non-UTC timezone, we must convert to local time first.
 */
function toDateTimeTimeZone(
  isoString: string,
  timeZone?: string,
): GraphDateTimeTimeZone {
  const tz = timeZone || "UTC";
  if (tz === "UTC") {
    // Strip Z — Outlook expects bare datetime with timeZone: "UTC"
    return { dateTime: isoString.replace(/Z$/, ""), timeZone: "UTC" };
  }
  // Convert UTC to local time in the target timezone
  const date = new Date(isoString);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "00";
  const localDateTime = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
  return { dateTime: localDateTime, timeZone: tz };
}

/** Map our attendee format to Outlook attendee format. */
function toOutlookAttendees(
  attendees: { email: string; name?: string }[],
): { emailAddress: { address: string; name: string }; type: string }[] {
  return attendees.map((a) => ({
    emailAddress: { address: a.email, name: a.name || a.email },
    type: "required",
  }));
}

/**
 * Convert a NewProviderEvent to the Outlook Graph API create body.
 */
export function toOutlookCreateBody(event: NewProviderEvent): Record<string, unknown> {
  const body: Record<string, unknown> = {
    subject: event.title,
    start: toDateTimeTimeZone(event.start, event.timeZone),
    end: toDateTimeTimeZone(event.end, event.timeZone),
    isAllDay: event.isAllDay || false,
  };

  if (event.description) {
    body.body = { contentType: "html", content: event.description };
  }
  if (event.location) {
    body.location = { displayName: event.location };
  }
  if (event.attendees && event.attendees.length > 0) {
    body.attendees = toOutlookAttendees(event.attendees);
  }
  if (event.transparency === "transparent") {
    body.showAs = "free";
  } else if (event.transparency === "opaque") {
    body.showAs = "busy";
  }
  if (event.visibility === "private") {
    body.sensitivity = "private";
  }
  if (event.conferencing?.type === "create") {
    body.isOnlineMeeting = true;
    body.onlineMeetingProvider = "teamsForBusiness";
  }

  return body;
}

/**
 * Convert a ProviderEventPatch to the Outlook Graph API patch body.
 * Only includes fields that are present in the patch.
 */
export function toOutlookPatchBody(patch: ProviderEventPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if (patch.summary !== undefined) body.subject = patch.summary;
  if (patch.description !== undefined) {
    body.body = { contentType: "html", content: patch.description };
  }
  if (patch.location !== undefined) {
    body.location = { displayName: patch.location };
  }
  if (patch.start !== undefined) {
    body.start = toDateTimeTimeZone(patch.start, patch.timeZone);
  }
  if (patch.end !== undefined) {
    body.end = toDateTimeTimeZone(patch.end, patch.timeZone);
  }
  if (patch.isAllDay !== undefined) {
    body.isAllDay = patch.isAllDay;
  }
  if (patch.attendees !== undefined) {
    body.attendees = patch.attendees
      ? toOutlookAttendees(patch.attendees)
      : [];
  }
  if (patch.transparency !== undefined) {
    body.showAs = patch.transparency === "transparent" ? "free" : "busy";
  }
  if (patch.visibility !== undefined) {
    body.sensitivity = patch.visibility === "private" ? "private" : "normal";
  }
  if (patch.conferencing !== undefined) {
    if (patch.conferencing === null) {
      body.isOnlineMeeting = false;
    } else if (patch.conferencing.type === "create") {
      body.isOnlineMeeting = true;
      body.onlineMeetingProvider = "teamsForBusiness";
    }
  }

  return body;
}
