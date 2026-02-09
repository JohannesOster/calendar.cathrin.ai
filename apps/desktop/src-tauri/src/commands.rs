use crate::calendar_api::{CalendarClient, GoogleCalendar};
use crate::oauth::{
    build_auth_url, build_redirect_uri, exchange_code_for_tokens, find_available_port,
    refresh_access_token, wait_for_callback, CallbackResult, OAuthConfig, PkceChallenge,
};
use crate::storage::{AccountStore, EventStore, StoredAccount, StoredCalendar, StoredEvent, weeks_in_range};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Wry};
use tauri_plugin_opener::OpenerExt;

/// Buffer time (seconds) before token expiration to trigger refresh
const TOKEN_REFRESH_BUFFER_SECS: u64 = 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarAccount {
    pub id: String,
    pub email: String,
    pub calendars: Vec<Calendar>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Calendar {
    pub id: String,
    pub name: String,
    pub color: String,
    pub visible: bool,
    #[serde(rename = "isDefault")]
    pub is_default: bool,
}

impl From<StoredAccount> for CalendarAccount {
    fn from(account: StoredAccount) -> Self {
        Self {
            id: account.id,
            email: account.email,
            calendars: account.calendars.into_iter().map(Calendar::from).collect(),
        }
    }
}

impl From<StoredCalendar> for Calendar {
    fn from(cal: StoredCalendar) -> Self {
        Self {
            id: cal.id,
            name: cal.name,
            color: cal.color,
            visible: cal.visible,
            is_default: cal.is_primary,
        }
    }
}

fn google_calendar_to_stored(cal: GoogleCalendar) -> StoredCalendar {
    StoredCalendar {
        id: cal.id,
        name: cal.summary,
        color: cal.background_color.unwrap_or_else(|| "#4285f4".to_string()),
        visible: true,
        is_primary: cal.primary.unwrap_or(false),
    }
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

/// Start the OAuth flow - this runs the complete flow and returns the account
#[tauri::command]
pub async fn start_oauth_flow(app: AppHandle<Wry>) -> Result<CalendarAccount, String> {
    let config = OAuthConfig::from_env().map_err(|e| e.to_string())?;
    let pkce = PkceChallenge::new();

    // Find an available port for the callback server
    let port = find_available_port().map_err(|e| e.to_string())?;
    let redirect_uri = build_redirect_uri(port);

    // Build the authorization URL
    let auth_url = build_auth_url(&config, &redirect_uri, &pkce).map_err(|e| e.to_string())?;

    // Store the verifier for later use
    let verifier = pkce.verifier.clone();
    let redirect_uri_clone = redirect_uri.clone();

    // Open the URL in the default browser
    app.opener()
        .open_url(&auth_url, None::<&str>)
        .map_err(|e| e.to_string())?;

    // Wait for the callback in a blocking thread
    let callback_result = tokio::task::spawn_blocking(move || wait_for_callback(port))
        .await
        .map_err(|e| format!("Failed to wait for callback: {}", e))?
        .map_err(|e| e.to_string())?;

    // Handle the callback result
    let code = match callback_result {
        CallbackResult::Success(code) => code,
        CallbackResult::Error(err) => {
            return Err(if err == "access_denied" {
                "Authorization was cancelled".to_string()
            } else {
                format!("Authorization failed: {}", err)
            });
        }
    };

    // Exchange the code for tokens
    let tokens = exchange_code_for_tokens(&config, &redirect_uri_clone, &code, &verifier)
        .await
        .map_err(|e| e.to_string())?;

    // Fetch user info
    let client = CalendarClient::new();
    let user_info = client
        .fetch_user_info(&tokens.access_token)
        .await
        .map_err(|e| e.to_string())?;

    // Fetch calendars
    let google_calendars = client
        .fetch_calendar_list(&tokens.access_token)
        .await
        .map_err(|e| e.to_string())?;

    // Convert to stored format
    let calendars: Vec<StoredCalendar> = google_calendars
        .into_iter()
        .map(google_calendar_to_stored)
        .collect();

    // Calculate token expiration
    let expires_at = current_timestamp() + tokens.expires_in;

    // Create account
    let account = StoredAccount {
        id: user_info.id.clone(),
        email: user_info.email,
        refresh_token: tokens
            .refresh_token
            .ok_or("No refresh token received - user may need to re-authorize")?,
        access_token: Some(tokens.access_token),
        token_expires_at: Some(expires_at),
        calendars,
    };

    // Save to storage
    AccountStore::save_account(&app, account.clone()).map_err(|e| e.to_string())?;

    Ok(account.into())
}

/// Get all connected accounts
#[tauri::command]
pub async fn get_connected_accounts(app: AppHandle<Wry>) -> Result<Vec<CalendarAccount>, String> {
    let accounts = AccountStore::get_accounts(&app).map_err(|e| e.to_string())?;
    Ok(accounts.into_iter().map(CalendarAccount::from).collect())
}

/// Remove a connected account
#[tauri::command]
pub async fn remove_account(app: AppHandle<Wry>, account_id: String) -> Result<(), String> {
    AccountStore::remove_account(&app, &account_id).map_err(|e| e.to_string())
}

/// Toggle calendar visibility
#[tauri::command]
pub async fn toggle_calendar_visibility(
    app: AppHandle<Wry>,
    account_id: String,
    calendar_id: String,
    visible: bool,
) -> Result<(), String> {
    AccountStore::update_calendar_visibility(&app, &account_id, &calendar_id, visible)
        .map_err(|e| e.to_string())
}

/// Refresh calendars for an account (fetches latest from Google)
#[tauri::command]
pub async fn refresh_account_calendars(
    app: AppHandle<Wry>,
    account_id: String,
) -> Result<CalendarAccount, String> {
    let config = OAuthConfig::from_env().map_err(|e| e.to_string())?;
    let mut account = AccountStore::get_account(&app, &account_id).map_err(|e| e.to_string())?;

    // Check if token needs refresh
    let now = current_timestamp();
    let needs_refresh = account
        .token_expires_at
        .map(|exp| now >= exp - TOKEN_REFRESH_BUFFER_SECS)
        .unwrap_or(true);

    if needs_refresh || account.access_token.is_none() {
        // Refresh the access token
        let tokens = refresh_access_token(&config, &account.refresh_token)
            .await
            .map_err(|e| e.to_string())?;

        let expires_at = now + tokens.expires_in;
        account.access_token = Some(tokens.access_token.clone());
        account.token_expires_at = Some(expires_at);

        AccountStore::update_access_token(
            &app,
            &account_id,
            tokens.access_token.clone(),
            expires_at,
        )
        .map_err(|e| e.to_string())?;
    }

    // Fetch fresh calendars
    let client = CalendarClient::new();
    let access_token = account.access_token.as_ref().ok_or("No access token")?;
    let google_calendars = client
        .fetch_calendar_list(access_token)
        .await
        .map_err(|e| e.to_string())?;

    // Convert and save calendars
    let calendars: Vec<StoredCalendar> = google_calendars
        .into_iter()
        .map(google_calendar_to_stored)
        .collect();

    AccountStore::update_calendars(&app, &account_id, calendars.clone())
        .map_err(|e| e.to_string())?;

    // Fetch updated account
    let updated_account =
        AccountStore::get_account(&app, &account_id).map_err(|e| e.to_string())?;
    Ok(updated_account.into())
}

/// Ensure we have a valid access token for an account (refresh if needed)
#[tauri::command]
pub async fn ensure_valid_token(app: AppHandle<Wry>, account_id: String) -> Result<String, String> {
    let config = OAuthConfig::from_env().map_err(|e| e.to_string())?;
    let account = AccountStore::get_account(&app, &account_id).map_err(|e| e.to_string())?;

    let now = current_timestamp();
    let needs_refresh = account
        .token_expires_at
        .map(|exp| now >= exp - TOKEN_REFRESH_BUFFER_SECS)
        .unwrap_or(true);

    if needs_refresh || account.access_token.is_none() {
        let tokens = refresh_access_token(&config, &account.refresh_token)
            .await
            .map_err(|e| e.to_string())?;

        let expires_at = now + tokens.expires_in;
        AccountStore::update_access_token(
            &app,
            &account_id,
            tokens.access_token.clone(),
            expires_at,
        )
        .map_err(|e| e.to_string())?;

        Ok(tokens.access_token)
    } else {
        account.access_token.ok_or("No access token".to_string())
    }
}

/// Fetch events for all visible calendars in an account
/// Caches results before returning for instant display on next app launch
#[tauri::command]
pub async fn fetch_events(
    app: AppHandle<Wry>,
    account_id: String,
    time_min: String,
    time_max: String,
) -> Result<Vec<StoredEvent>, String> {
    // Get account and verify it exists
    let account = AccountStore::get_account(&app, &account_id).map_err(|e| e.to_string())?;

    // Get visible calendars
    let visible_calendars: Vec<_> = account.calendars.iter().filter(|c| c.visible).collect();

    // Calculate which weeks are covered by this fetch
    let fetched_weeks = weeks_in_range(&time_min, &time_max);

    // If no visible calendars, return empty and cache empty
    if visible_calendars.is_empty() {
        EventStore::save_events(
            &app,
            &account_id,
            Vec::new(),
            fetched_weeks,
        )
        .map_err(|e| e.to_string())?;
        return Ok(Vec::new());
    }

    // Ensure valid token (refresh if needed)
    let access_token = ensure_valid_token(app.clone(), account_id.clone()).await?;

    // Fetch events from all visible calendars
    let client = CalendarClient::new();
    let mut all_events: Vec<StoredEvent> = Vec::new();

    for calendar in visible_calendars {
        let google_events = client
            .fetch_events(&access_token, &calendar.id, &time_min, &time_max)
            .await
            .map_err(|e| e.to_string())?;

        // Convert GoogleEvent to StoredEvent with calendar color
        for event in google_events {
            let (start, is_all_day) = if let Some(ref dt) = event.start.date_time {
                (dt.clone(), false)
            } else if let Some(ref d) = event.start.date {
                (d.clone(), true)
            } else {
                continue; // Skip events with no start time
            };

            let end = if let Some(ref dt) = event.end.date_time {
                dt.clone()
            } else if let Some(ref d) = event.end.date {
                d.clone()
            } else {
                start.clone() // Fallback to start time
            };

            all_events.push(StoredEvent {
                id: event.id,
                calendar_id: calendar.id.clone(),
                title: event.summary.unwrap_or_default(),
                start,
                end,
                is_all_day,
                color: calendar.color.clone(),
            });
        }
    }

    // Save to cache before returning
    EventStore::save_events(
        &app,
        &account_id,
        all_events.clone(),
        fetched_weeks,
    )
    .map_err(|e| e.to_string())?;

    Ok(all_events)
}

/// Get cached events for an account (if available)
#[tauri::command]
pub async fn get_cached_events(
    app: AppHandle<Wry>,
    account_id: String,
) -> Result<Option<crate::storage::EventCache>, String> {
    EventStore::get_cached_events(&app, &account_id).map_err(|e| e.to_string())
}

/// Clear cached events for an account
#[tauri::command]
pub async fn clear_cached_events(
    app: AppHandle<Wry>,
    account_id: String,
) -> Result<(), String> {
    EventStore::clear_events(&app, &account_id).map_err(|e| e.to_string())
}

/// Fetch events for a specific week and merge into cache
/// Returns the events fetched for this week
#[tauri::command]
pub async fn fetch_events_for_week(
    app: AppHandle<Wry>,
    account_id: String,
    week_id: String,
    time_min: String,
    time_max: String,
) -> Result<Vec<StoredEvent>, String> {
    // Get account and verify it exists
    let account = AccountStore::get_account(&app, &account_id).map_err(|e| e.to_string())?;

    // Get visible calendars
    let visible_calendars: Vec<_> = account.calendars.iter().filter(|c| c.visible).collect();

    // If no visible calendars, merge empty and return
    if visible_calendars.is_empty() {
        EventStore::merge_events(&app, &account_id, Vec::new(), vec![week_id])
            .map_err(|e| e.to_string())?;
        return Ok(Vec::new());
    }

    // Ensure valid token (refresh if needed)
    let access_token = ensure_valid_token(app.clone(), account_id.clone()).await?;

    // Fetch events from all visible calendars
    let client = CalendarClient::new();
    let mut all_events: Vec<StoredEvent> = Vec::new();

    for calendar in visible_calendars {
        let google_events = client
            .fetch_events(&access_token, &calendar.id, &time_min, &time_max)
            .await
            .map_err(|e| e.to_string())?;

        // Convert GoogleEvent to StoredEvent with calendar color
        for event in google_events {
            let (start, is_all_day) = if let Some(ref dt) = event.start.date_time {
                (dt.clone(), false)
            } else if let Some(ref d) = event.start.date {
                (d.clone(), true)
            } else {
                continue; // Skip events with no start time
            };

            let end = if let Some(ref dt) = event.end.date_time {
                dt.clone()
            } else if let Some(ref d) = event.end.date {
                d.clone()
            } else {
                start.clone() // Fallback to start time
            };

            all_events.push(StoredEvent {
                id: event.id,
                calendar_id: calendar.id.clone(),
                title: event.summary.unwrap_or_default(),
                start,
                end,
                is_all_day,
                color: calendar.color.clone(),
            });
        }
    }

    // Merge into cache (preserves existing events, adds new week)
    EventStore::merge_events(&app, &account_id, all_events.clone(), vec![week_id])
        .map_err(|e| e.to_string())?;

    Ok(all_events)
}

// Session token storage key
const SESSION_TOKEN_KEY: &str = "session_token";
const SESSION_STORE_PATH: &str = "session.json";

/// Save session token to secure storage
#[tauri::command]
pub async fn save_session_token(app: AppHandle<Wry>, token: String) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;

    let store = app
        .store(SESSION_STORE_PATH)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    store
        .set(SESSION_TOKEN_KEY, serde_json::json!(token));

    store
        .save()
        .map_err(|e| format!("Failed to save store: {}", e))?;

    Ok(())
}

/// Get session token from secure storage
#[tauri::command]
pub async fn get_session_token(app: AppHandle<Wry>) -> Result<Option<String>, String> {
    use tauri_plugin_store::StoreExt;

    let store = app
        .store(SESSION_STORE_PATH)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    let token = store
        .get(SESSION_TOKEN_KEY)
        .and_then(|v| v.as_str().map(|s| s.to_string()));

    Ok(token)
}

/// Clear session token from secure storage
#[tauri::command]
pub async fn clear_session_token(app: AppHandle<Wry>) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;

    let store = app
        .store(SESSION_STORE_PATH)
        .map_err(|e| format!("Failed to open store: {}", e))?;

    store.delete(SESSION_TOKEN_KEY);

    store
        .save()
        .map_err(|e| format!("Failed to save store: {}", e))?;

    Ok(())
}

/// Open a URL in the default browser
#[tauri::command]
pub async fn open_url(app: AppHandle<Wry>, url: String) -> Result<(), String> {
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| format!("Failed to open URL: {}", e))
}

// ============================================================================
// Local SQLite Cache Commands
// ============================================================================

use crate::local_cache::{CachedEvent, LocalCache};
use std::sync::OnceLock;

/// Global cache instance
static CACHE: OnceLock<LocalCache> = OnceLock::new();

/// Initialize the local cache (call during app setup)
pub fn init_local_cache(app: &AppHandle<Wry>) -> Result<(), String> {
    let cache = LocalCache::new(app).map_err(|e| e.to_string())?;
    CACHE.set(cache).map_err(|_| "Cache already initialized".to_string())
}

fn get_cache() -> Result<&'static LocalCache, String> {
    CACHE.get().ok_or_else(|| "Cache not initialized".to_string())
}

/// Get cached events for a date range
#[tauri::command]
pub async fn get_local_cached_events(
    start: String,
    end: String,
) -> Result<Vec<CachedEvent>, String> {
    let cache = get_cache()?;
    cache.get_events(&start, &end).map_err(|e| e.to_string())
}

/// Store events in local cache
#[tauri::command]
pub async fn cache_events_locally(events: Vec<CachedEvent>) -> Result<usize, String> {
    let cache = get_cache()?;
    cache.upsert_events(&events).map_err(|e| e.to_string())
}

/// Clear local event cache
#[tauri::command]
pub async fn clear_local_cache() -> Result<(), String> {
    let cache = get_cache()?;
    cache.clear().map_err(|e| e.to_string())
}

/// Prune old events from cache (older than 90 days)
#[tauri::command]
pub async fn prune_local_cache() -> Result<usize, String> {
    let cache = get_cache()?;
    cache.prune_old_events(90).map_err(|e| e.to_string())
}

/// Delete a single event from local cache by its ID
#[tauri::command]
pub async fn delete_cached_event_by_id(event_id: String) -> Result<bool, String> {
    let cache = get_cache()?;
    cache.delete_event_by_id(&event_id).map_err(|e| e.to_string())
}

/// Delete events for specific weeks from local cache
/// week_ids: Array of ISO week IDs like ["2025-W05", "2025-W06"]
/// week_bounds: Array of {start, end} date strings for each week
#[tauri::command]
pub async fn delete_cached_weeks(week_bounds: Vec<WeekBound>) -> Result<usize, String> {
    let cache = get_cache()?;
    let mut total_deleted = 0;

    for bound in week_bounds {
        let deleted = cache
            .delete_events_in_range(&bound.start, &bound.end)
            .map_err(|e| e.to_string())?;
        total_deleted += deleted;
    }

    Ok(total_deleted)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeekBound {
    pub start: String,
    pub end: String,
}

/// Week fetch time entry for persistence
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeekFetchTime {
    pub week_id: String,
    pub fetched_at: i64, // Unix timestamp in milliseconds
}

const WEEK_FETCH_TIMES_KEY: &str = "week_fetch_times";

/// Get persisted week fetch times from SQLite
/// Returns a list of {week_id, fetched_at} entries
#[tauri::command]
pub async fn get_week_fetch_times() -> Result<Vec<WeekFetchTime>, String> {
    let cache = get_cache()?;
    let json = cache
        .get_metadata(WEEK_FETCH_TIMES_KEY)
        .map_err(|e| e.to_string())?;

    match json {
        Some(data) => serde_json::from_str(&data).map_err(|e| e.to_string()),
        None => Ok(Vec::new()),
    }
}

/// Save week fetch times to SQLite for persistence across restarts
#[tauri::command]
pub async fn save_week_fetch_times(times: Vec<WeekFetchTime>) -> Result<(), String> {
    let cache = get_cache()?;
    let json = serde_json::to_string(&times).map_err(|e| e.to_string())?;
    cache
        .set_metadata(WEEK_FETCH_TIMES_KEY, &json)
        .map_err(|e| e.to_string())
}

/// Clear week fetch times (called on logout)
#[tauri::command]
pub async fn clear_week_fetch_times() -> Result<(), String> {
    let cache = get_cache()?;
    cache
        .delete_metadata(WEEK_FETCH_TIMES_KEY)
        .map_err(|e| e.to_string())
}
