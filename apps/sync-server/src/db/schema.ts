import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  unique,
  index,
  boolean,
  jsonb,
  serial,
  uuid,
} from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";

export const users = pgTable(
  "users",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    email: text("email").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [index("users_email_idx").on(table.email)]
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // 'google' | 'outlook' | 'caldav'
    providerAccountId: text("provider_account_id").notNull(),
    email: text("email").notNull(),
    encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
    encryptedAccessToken: text("encrypted_access_token"),
    tokenExpiresAt: timestamp("token_expires_at"),
    syncToken: text("sync_token"),
    // Sync status tracking
    syncStatus: text("sync_status").default("pending"), // pending, syncing, complete, failed
    syncError: text("sync_error"),
    lastSyncAt: timestamp("last_sync_at"),
    lastReanchorAt: timestamp("last_reanchor_at"), // Last time reanchoring ran for this account
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("accounts_provider_account_idx").on(
      table.provider,
      table.providerAccountId
    ),
    index("accounts_user_id_idx").on(table.userId),
  ]
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)]
);

/**
 * Server-side event cache
 * Stores events fetched from calendar providers for quick access
 */
export const serverEvents = pgTable(
  "events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    calendarId: text("calendar_id").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    title: text("title").notNull(),
    start: timestamp("start").notNull(),
    end: timestamp("end").notNull(),
    isAllDay: boolean("is_all_day").default(false),
    color: text("color"),
    location: text("location"),
    description: text("description"),
    transparency: text("transparency"), // opaque (busy) or transparent (free)
    visibility: text("visibility"), // default, public, private
    reminders: jsonb("reminders"), // Array of { method, minutes }
    colorId: text("color_id"), // Google colorId "1"-"11" for per-event color override
    conferencing: jsonb("conferencing"), // { uri, label } or null
    timeZone: text("time_zone"), // IANA timezone identifier, e.g. "America/New_York"
    attendees: jsonb("attendees"), // Array of { email, name?, responseStatus, isOrganizer?, isSelf? }
    icalUid: text("ical_uid"), // RFC 5545 iCalendar UID for cross-account dedup
    status: text("status"), // confirmed, tentative, cancelled
    isReadOnly: boolean("is_read_only").default(false),
    readOnlyReason: text("read_only_reason"),
    raw: jsonb("raw"), // Store raw provider event for future fields
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("events_account_calendar_idx").on(table.accountId, table.calendarId),
    index("events_start_end_idx").on(table.start, table.end),
    uniqueIndex("events_account_provider_id_idx").on(
      table.accountId,
      table.providerEventId
    ),
  ]
);

/**
 * Tracks sync state per calendar for incremental sync
 */
export const calendarSyncState = pgTable(
  "calendar_sync_state",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    calendarId: text("calendar_id").notNull(),
    accessRole: text("access_role"),
    syncToken: text("sync_token"),
    lastSyncAt: timestamp("last_sync_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    uniqueIndex("sync_state_account_calendar_idx").on(
      table.accountId,
      table.calendarId
    ),
  ]
);

/**
 * Temporary storage for OAuth state tokens
 * Used for desktop app polling callback mechanism
 */
export const oauthPendingTokens = pgTable(
  "oauth_pending_tokens",
  {
    state: text("state").primaryKey(),
    userId: text("user_id"), // Existing user ID for "add account" flow
    token: text("token"),
    error: text("error"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("oauth_pending_expires_idx").on(table.expiresAt)]
);

/**
 * Tracks which weeks have been fetched from the calendar provider
 * Used to distinguish "empty week (no events)" from "week never fetched"
 * Enables on-demand fetching when client requests unfetched ranges
 */
export const fetchedWeeks = pgTable(
  "fetched_weeks",
  {
    id: serial("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    calendarId: text("calendar_id").notNull(),
    weekId: text("week_id").notNull(), // ISO 8601: "2025-W05"
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  },
  (table) => [
    unique("fetched_weeks_unique").on(
      table.accountId,
      table.calendarId,
      table.weekId
    ),
    index("fetched_weeks_lookup_idx").on(
      table.accountId,
      table.calendarId,
      table.weekId
    ),
  ]
);

/**
 * Tracks Google Calendar push notification watch channels.
 * One channel per (account, calendar) pair.
 */
/**
 * Cached contacts fetched from provider APIs (e.g. Google People API).
 * Used as fallback tier in contact suggestions when no event-based
 * history exists for a contact.
 */
export const providerContacts = pgTable(
  "provider_contacts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  },
  (table) => [
    unique("provider_contacts_account_email").on(table.accountId, table.email),
    index("provider_contacts_account_idx").on(table.accountId),
  ]
);

export const watchChannels = pgTable(
  "watch_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    calendarId: text("calendar_id").notNull(),
    channelId: text("channel_id").notNull().unique(), // UUID sent to Google
    resourceId: text("resource_id").notNull(),         // Returned by Google
    expiration: timestamp("expiration", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique("watch_channels_account_calendar").on(table.accountId, table.calendarId),
    index("watch_channels_expiration_idx").on(table.expiration),
  ]
);
