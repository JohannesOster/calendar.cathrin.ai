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
  location?: string;
  description?: string;
  isReadOnly: boolean;
  readOnlyReason?: string;
  transparency?: string;
  visibility?: string;
  reminders?: { method: string; minutes: number }[];
  colorId?: string;
  conferencing?: { uri: string; label?: string } | null;
  /** IANA timezone identifier, e.g. "America/New_York" */
  timeZone?: string;
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
  accessRole?: string;
}

/**
 * Sync status for an account
 */
export type SyncStatus = "pending" | "syncing" | "complete" | "failed";

/**
 * A connected calendar account as transported over the API
 */
export interface ApiAccount {
  id: string;
  email: string;
  provider: Provider;
  syncStatus?: SyncStatus;
  syncError?: string | null;
  lastSyncAt?: string | null;
}

