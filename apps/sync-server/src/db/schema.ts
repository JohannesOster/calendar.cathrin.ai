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
 * Stores events fetched from Google Calendar for quick access
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
    googleEventId: text("google_event_id").notNull(),
    title: text("title").notNull(),
    start: timestamp("start").notNull(),
    end: timestamp("end").notNull(),
    isAllDay: boolean("is_all_day").default(false),
    color: text("color"),
    status: text("status"), // confirmed, tentative, cancelled
    raw: jsonb("raw"), // Store raw Google event for future fields
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("events_account_calendar_idx").on(table.accountId, table.calendarId),
    index("events_start_end_idx").on(table.start, table.end),
    uniqueIndex("events_account_google_id_idx").on(
      table.accountId,
      table.googleEventId
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
