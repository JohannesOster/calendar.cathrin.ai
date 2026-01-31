use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Wry};
use tauri_plugin_store::StoreExt;
use thiserror::Error;

const STORE_PATH: &str = "accounts.json";
const ACCOUNTS_KEY: &str = "accounts";

#[derive(Error, Debug)]
pub enum StorageError {
    #[error("Store error: {0}")]
    StoreError(String),
    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),
    #[error("Account not found: {0}")]
    AccountNotFound(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredCalendar {
    pub id: String,
    pub name: String,
    pub color: String,
    pub visible: bool,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredEvent {
    pub id: String,
    pub calendar_id: String,
    pub title: String,
    pub start: String,     // ISO 8601 / RFC3339
    pub end: String,
    pub is_all_day: bool,
    pub color: String,     // Hex color from calendar
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventCache {
    pub events: Vec<StoredEvent>,
    pub last_fetched_at: u64,  // Unix timestamp
    #[serde(default)]
    pub fetched_weeks: Vec<String>,  // ISO week format: "YYYY-Wnn"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredAccount {
    pub id: String,
    pub email: String,
    pub refresh_token: String,
    pub access_token: Option<String>,
    pub token_expires_at: Option<u64>,
    pub calendars: Vec<StoredCalendar>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct AccountsData {
    accounts: Vec<StoredAccount>,
}

pub struct AccountStore;

impl AccountStore {
    /// Get all stored accounts
    pub fn get_accounts(app: &AppHandle<Wry>) -> Result<Vec<StoredAccount>, StorageError> {
        let store = app.store(STORE_PATH).map_err(|e| StorageError::StoreError(e.to_string()))?;

        let data: AccountsData = store
            .get(ACCOUNTS_KEY)
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();

        Ok(data.accounts)
    }

    /// Save a new account or update an existing one
    pub fn save_account(app: &AppHandle<Wry>, account: StoredAccount) -> Result<(), StorageError> {
        let store = app.store(STORE_PATH).map_err(|e| StorageError::StoreError(e.to_string()))?;

        let mut data: AccountsData = store
            .get(ACCOUNTS_KEY)
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();

        // Update existing account or add new one
        if let Some(existing) = data.accounts.iter_mut().find(|a| a.id == account.id) {
            *existing = account;
        } else {
            data.accounts.push(account);
        }

        store.set(ACCOUNTS_KEY, serde_json::to_value(&data)?);
        store.save().map_err(|e| StorageError::StoreError(e.to_string()))?;

        Ok(())
    }

    /// Get a specific account by ID
    pub fn get_account(app: &AppHandle<Wry>, account_id: &str) -> Result<StoredAccount, StorageError> {
        let accounts = Self::get_accounts(app)?;
        accounts
            .into_iter()
            .find(|a| a.id == account_id)
            .ok_or_else(|| StorageError::AccountNotFound(account_id.to_string()))
    }

    /// Remove an account
    pub fn remove_account(app: &AppHandle<Wry>, account_id: &str) -> Result<(), StorageError> {
        let store = app.store(STORE_PATH).map_err(|e| StorageError::StoreError(e.to_string()))?;

        let mut data: AccountsData = store
            .get(ACCOUNTS_KEY)
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();

        data.accounts.retain(|a| a.id != account_id);

        store.set(ACCOUNTS_KEY, serde_json::to_value(&data)?);
        store.save().map_err(|e| StorageError::StoreError(e.to_string()))?;

        Ok(())
    }

    /// Update calendar visibility for a specific calendar
    pub fn update_calendar_visibility(
        app: &AppHandle<Wry>,
        account_id: &str,
        calendar_id: &str,
        visible: bool,
    ) -> Result<(), StorageError> {
        let store = app.store(STORE_PATH).map_err(|e| StorageError::StoreError(e.to_string()))?;

        let mut data: AccountsData = store
            .get(ACCOUNTS_KEY)
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();

        if let Some(account) = data.accounts.iter_mut().find(|a| a.id == account_id) {
            if let Some(calendar) = account.calendars.iter_mut().find(|c| c.id == calendar_id) {
                calendar.visible = visible;
            }
        }

        store.set(ACCOUNTS_KEY, serde_json::to_value(&data)?);
        store.save().map_err(|e| StorageError::StoreError(e.to_string()))?;

        Ok(())
    }

    /// Update the access token for an account
    pub fn update_access_token(
        app: &AppHandle<Wry>,
        account_id: &str,
        access_token: String,
        expires_at: u64,
    ) -> Result<(), StorageError> {
        let store = app.store(STORE_PATH).map_err(|e| StorageError::StoreError(e.to_string()))?;

        let mut data: AccountsData = store
            .get(ACCOUNTS_KEY)
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();

        if let Some(account) = data.accounts.iter_mut().find(|a| a.id == account_id) {
            account.access_token = Some(access_token);
            account.token_expires_at = Some(expires_at);
        }

        store.set(ACCOUNTS_KEY, serde_json::to_value(&data)?);
        store.save().map_err(|e| StorageError::StoreError(e.to_string()))?;

        Ok(())
    }

    /// Update calendars for an account (preserving visibility preferences)
    pub fn update_calendars(
        app: &AppHandle<Wry>,
        account_id: &str,
        new_calendars: Vec<StoredCalendar>,
    ) -> Result<(), StorageError> {
        let store = app.store(STORE_PATH).map_err(|e| StorageError::StoreError(e.to_string()))?;

        let mut data: AccountsData = store
            .get(ACCOUNTS_KEY)
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();

        if let Some(account) = data.accounts.iter_mut().find(|a| a.id == account_id) {
            // Build a map of existing visibility preferences
            let visibility_prefs: HashMap<String, bool> = account
                .calendars
                .iter()
                .map(|c| (c.id.clone(), c.visible))
                .collect();

            // Update calendars while preserving visibility preferences
            account.calendars = new_calendars
                .into_iter()
                .map(|mut cal| {
                    if let Some(&visible) = visibility_prefs.get(&cal.id) {
                        cal.visible = visible;
                    }
                    cal
                })
                .collect();
        }

        store.set(ACCOUNTS_KEY, serde_json::to_value(&data)?);
        store.save().map_err(|e| StorageError::StoreError(e.to_string()))?;

        Ok(())
    }
}

/// Parse a date string (ISO 8601) to NaiveDate
/// Handles various formats: full datetime with Z, datetime with timezone, date only
fn parse_date_string(date_str: &str) -> Option<chrono::NaiveDate> {
    use chrono::{NaiveDate, NaiveDateTime};

    // Try parsing as full datetime first
    if let Ok(dt) = NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S%.fZ") {
        return Some(dt.date());
    }
    if let Ok(dt) = NaiveDateTime::parse_from_str(date_str, "%Y-%m-%dT%H:%M:%S%:z") {
        return Some(dt.date());
    }
    if let Ok(d) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
        return Some(d);
    }
    // Try parsing just the date portion
    let date_part = date_str.split('T').next()?;
    NaiveDate::parse_from_str(date_part, "%Y-%m-%d").ok()
}

/// Convert a NaiveDate to an ISO week ID ("YYYY-Wnn")
fn date_to_week_id_internal(date: chrono::NaiveDate) -> String {
    use chrono::Datelike;
    let iso_week = date.iso_week();
    format!("{}-W{:02}", iso_week.year(), iso_week.week())
}

/// Get all week IDs between two dates (inclusive)
/// Note: Uses day-by-day iteration because ISO weeks (Mon-Sun) don't align
/// perfectly, making skip-by-7 unreliable for small ranges
pub fn weeks_in_range(start: &str, end: &str) -> Vec<String> {
    use chrono::Duration;

    let start_date = match parse_date_string(start) {
        Some(d) => d,
        None => return Vec::new(),
    };
    let end_date = match parse_date_string(end) {
        Some(d) => d,
        None => return Vec::new(),
    };

    let mut weeks = Vec::new();
    let mut current = start_date;

    while current <= end_date {
        let week_id = date_to_week_id_internal(current);
        if weeks.last() != Some(&week_id) {
            weeks.push(week_id);
        }
        current += Duration::days(1);
    }

    weeks
}

pub struct EventStore;

impl EventStore {
    /// Build the storage key for an account's event cache
    fn events_key(account_id: &str) -> String {
        format!("events_{}", account_id)
    }

    /// Save events to cache for an account
    pub fn save_events(
        app: &AppHandle<Wry>,
        account_id: &str,
        events: Vec<StoredEvent>,
        fetched_weeks: Vec<String>,
    ) -> Result<(), StorageError> {
        let store = app.store(STORE_PATH).map_err(|e| StorageError::StoreError(e.to_string()))?;

        let cache = EventCache {
            events,
            last_fetched_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            fetched_weeks,
        };

        store.set(Self::events_key(account_id), serde_json::to_value(&cache)?);
        store.save().map_err(|e| StorageError::StoreError(e.to_string()))?;

        Ok(())
    }

    /// Get cached events for an account
    pub fn get_cached_events(
        app: &AppHandle<Wry>,
        account_id: &str,
    ) -> Result<Option<EventCache>, StorageError> {
        let store = app.store(STORE_PATH).map_err(|e| StorageError::StoreError(e.to_string()))?;

        let cache: Option<EventCache> = store
            .get(Self::events_key(account_id))
            .and_then(|v| serde_json::from_value(v).ok());

        Ok(cache)
    }

    /// Clear cached events for an account
    pub fn clear_events(app: &AppHandle<Wry>, account_id: &str) -> Result<(), StorageError> {
        let store = app.store(STORE_PATH).map_err(|e| StorageError::StoreError(e.to_string()))?;

        store.delete(Self::events_key(account_id));
        store.save().map_err(|e| StorageError::StoreError(e.to_string()))?;

        Ok(())
    }

    /// Merge new events into the cache for an account
    /// Deduplicates by event ID (new events overwrite existing)
    /// Adds new weeks to fetched_weeks list
    pub fn merge_events(
        app: &AppHandle<Wry>,
        account_id: &str,
        new_events: Vec<StoredEvent>,
        new_weeks: Vec<String>,
    ) -> Result<(), StorageError> {
        let store = app.store(STORE_PATH).map_err(|e| StorageError::StoreError(e.to_string()))?;

        // Load existing cache
        let existing: Option<EventCache> = store
            .get(Self::events_key(account_id))
            .and_then(|v| serde_json::from_value(v).ok());

        let (mut events, mut fetched_weeks) = match existing {
            Some(cache) => (cache.events, cache.fetched_weeks),
            None => (Vec::new(), Vec::new()),
        };

        // Deduplicate events by ID (new events overwrite existing)
        let mut event_map: std::collections::HashMap<String, StoredEvent> = events
            .into_iter()
            .map(|e| (e.id.clone(), e))
            .collect();

        for event in new_events {
            event_map.insert(event.id.clone(), event);
        }

        events = event_map.into_values().collect();

        // Add new weeks to fetched_weeks (deduplicated)
        for week in new_weeks {
            if !fetched_weeks.contains(&week) {
                fetched_weeks.push(week);
            }
        }

        // Sort fetched_weeks for consistency
        fetched_weeks.sort();

        let cache = EventCache {
            events,
            last_fetched_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            fetched_weeks,
        };

        store.set(Self::events_key(account_id), serde_json::to_value(&cache)?);
        store.save().map_err(|e| StorageError::StoreError(e.to_string()))?;

        Ok(())
    }
}
