/**
 * Shared types for Cathrin Calendar API contracts
 *
 * These types are used for communication between the desktop client
 * and the sync server. Dates are represented as ISO 8601 strings
 * for reliable serialization across network boundaries.
 *
 * The desktop app may use different internal representations (e.g., Date objects)
 * and convert at API boundaries.
 */

/**
 * Calendar provider types supported by the sync server
 */
export type Provider = "google" | "outlook" | "caldav";

// =============================================================================
// API Contract Types (for sync server communication)
// =============================================================================

/**
 * A calendar event as transported over the API
 * Dates are ISO 8601 strings for reliable serialization
 */
export interface ApiCalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  /** ISO 8601 date string */
  start: string;
  /** ISO 8601 date string */
  end: string;
  isAllDay: boolean;
  color: string;
  provider: Provider;
}

/**
 * A calendar as transported over the API
 */
export interface ApiCalendar {
  id: string;
  accountId: string;
  name: string;
  color: string;
  visible: boolean;
  provider: Provider;
}

/**
 * A connected calendar account as transported over the API
 */
export interface ApiAccount {
  id: string;
  email: string;
  provider: Provider;
}

// =============================================================================
// Convenience aliases matching the epic's API contract naming
// =============================================================================

/** @deprecated Use ApiCalendarEvent for clarity */
export type CalendarEvent = ApiCalendarEvent;

/** @deprecated Use ApiCalendar for clarity */
export type Calendar = ApiCalendar;

/** @deprecated Use ApiAccount for clarity */
export type Account = ApiAccount;
