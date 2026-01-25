use crate::calendar_api::{CalendarClient, GoogleCalendar, GoogleEvent};
use crate::oauth::{
    build_auth_url, build_redirect_uri, exchange_code_for_tokens, find_available_port,
    refresh_access_token, wait_for_callback, CallbackResult, OAuthConfig, PkceChallenge,
};
use crate::storage::{AccountStore, StoredAccount, StoredCalendar};
use serde::{Deserialize, Serialize};
use chrono::{Duration, Utc};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Wry};
use tauri_plugin_opener::OpenerExt;

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
        .map(|exp| now >= exp - 60) // Refresh if less than 60 seconds until expiration
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
        .map(|exp| now >= exp - 60)
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

/// TEST COMMAND: Fetch events for a calendar (for verifying the API works)
/// This is temporary and will be replaced by a proper implementation in issue #20/#21
#[tauri::command]
pub async fn test_fetch_events(
    app: AppHandle<Wry>,
    account_id: String,
    calendar_id: String,
) -> Result<Vec<GoogleEvent>, String> {
    // Get a valid access token
    let access_token = ensure_valid_token(app.clone(), account_id.clone()).await?;

    // Calculate time window: 30 days before and after today (wider range for testing)
    let now = Utc::now();
    let time_min = (now - Duration::days(30)).format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let time_max = (now + Duration::days(30)).format("%Y-%m-%dT%H:%M:%SZ").to_string();

    println!("\n========================================");
    println!("=== TEST: Fetching events ===");
    println!("========================================");
    println!("Account ID: {}", account_id);
    println!("Calendar ID: {}", calendar_id);
    println!("Calendar ID (encoded): {}", urlencoding::encode(&calendar_id));
    println!("Time range: {} to {}", time_min, time_max);
    println!("Access token (first 20 chars): {}...", &access_token[..20.min(access_token.len())]);

    // Fetch events
    let client = CalendarClient::new();
    let events = client
        .fetch_events(&access_token, &calendar_id, &time_min, &time_max)
        .await
        .map_err(|e| {
            println!("=== ERROR: {} ===", e);
            e.to_string()
        })?;

    println!("========================================");
    println!("=== Found {} events ===", events.len());
    println!("========================================");
    for event in &events {
        let start = event.start.date_time.as_ref()
            .or(event.start.date.as_ref())
            .map(|s| s.as_str())
            .unwrap_or("no start");
        println!("  - {} ({})", event.summary.as_deref().unwrap_or("(no title)"), start);
    }
    println!("========================================\n");

    Ok(events)
}
