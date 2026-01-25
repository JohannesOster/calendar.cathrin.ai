use reqwest::Client;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const GOOGLE_USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_CALENDAR_LIST_URL: &str = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const GOOGLE_CALENDAR_EVENTS_URL: &str = "https://www.googleapis.com/calendar/v3/calendars";

#[derive(Error, Debug)]
pub enum CalendarApiError {
    #[error("HTTP request failed: {0}")]
    HttpError(#[from] reqwest::Error),
    #[error("API error: {0}")]
    ApiError(String),
    #[error("Unauthorized - token may be expired")]
    Unauthorized,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleUserInfo {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub picture: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleCalendar {
    pub id: String,
    pub summary: String,
    pub description: Option<String>,
    pub background_color: Option<String>,
    pub foreground_color: Option<String>,
    pub primary: Option<bool>,
    pub access_role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarListResponse {
    kind: String,
    etag: String,
    items: Vec<GoogleCalendar>,
    next_page_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventDateTime {
    pub date_time: Option<String>,
    pub date: Option<String>,
    pub time_zone: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleEvent {
    pub id: String,
    pub summary: Option<String>,
    pub start: EventDateTime,
    pub end: EventDateTime,
    pub color_id: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventsListResponse {
    kind: String,
    etag: String,
    #[serde(default)]
    items: Vec<GoogleEvent>,
    next_page_token: Option<String>,
}

pub struct CalendarClient {
    client: Client,
}

impl CalendarClient {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
        }
    }

    /// Fetch the user's profile information
    pub async fn fetch_user_info(&self, access_token: &str) -> Result<GoogleUserInfo, CalendarApiError> {
        let response = self
            .client
            .get(GOOGLE_USERINFO_URL)
            .bearer_auth(access_token)
            .send()
            .await?;

        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(CalendarApiError::Unauthorized);
        }

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(CalendarApiError::ApiError(error_text));
        }

        let user_info: GoogleUserInfo = response.json().await?;
        Ok(user_info)
    }

    /// Fetch all calendars for the authenticated user
    pub async fn fetch_calendar_list(&self, access_token: &str) -> Result<Vec<GoogleCalendar>, CalendarApiError> {
        let mut all_calendars = Vec::new();
        let mut page_token: Option<String> = None;

        loop {
            let mut url = reqwest::Url::parse(GOOGLE_CALENDAR_LIST_URL).unwrap();
            url.query_pairs_mut()
                .append_pair("maxResults", "250")
                .append_pair("minAccessRole", "reader");

            if let Some(ref token) = page_token {
                url.query_pairs_mut().append_pair("pageToken", token);
            }

            let response = self
                .client
                .get(url)
                .bearer_auth(access_token)
                .send()
                .await?;

            if response.status() == reqwest::StatusCode::UNAUTHORIZED {
                return Err(CalendarApiError::Unauthorized);
            }

            if !response.status().is_success() {
                let error_text = response.text().await.unwrap_or_default();
                return Err(CalendarApiError::ApiError(error_text));
            }

            let list_response: CalendarListResponse = response.json().await?;
            all_calendars.extend(list_response.items);

            page_token = list_response.next_page_token;
            if page_token.is_none() {
                break;
            }
        }

        Ok(all_calendars)
    }

    /// Fetch events for a calendar within a time range
    pub async fn fetch_events(
        &self,
        access_token: &str,
        calendar_id: &str,
        time_min: &str,
        time_max: &str,
    ) -> Result<Vec<GoogleEvent>, CalendarApiError> {
        let mut all_events = Vec::new();
        let mut page_token: Option<String> = None;

        let base_url = format!(
            "{}/{}/events",
            GOOGLE_CALENDAR_EVENTS_URL,
            urlencoding::encode(calendar_id)
        );

        println!("[DEBUG] Base URL: {}", base_url);

        loop {
            let mut url = reqwest::Url::parse(&base_url).unwrap();
            url.query_pairs_mut()
                .append_pair("timeMin", time_min)
                .append_pair("timeMax", time_max)
                .append_pair("singleEvents", "true")
                .append_pair("orderBy", "startTime")
                .append_pair("maxResults", "2500");

            if let Some(ref token) = page_token {
                url.query_pairs_mut().append_pair("pageToken", token);
            }

            println!("[DEBUG] Full URL: {}", url);

            let response = self
                .client
                .get(url)
                .bearer_auth(access_token)
                .send()
                .await?;

            println!("[DEBUG] Response status: {}", response.status());

            if response.status() == reqwest::StatusCode::UNAUTHORIZED {
                return Err(CalendarApiError::Unauthorized);
            }

            if !response.status().is_success() {
                let error_text = response.text().await.unwrap_or_default();
                println!("[DEBUG] Error response: {}", error_text);
                return Err(CalendarApiError::ApiError(error_text));
            }

            // Get raw text first to debug
            let response_text = response.text().await?;
            println!("[DEBUG] Raw response (first 500 chars): {}", &response_text[..response_text.len().min(500)]);

            let events_response: EventsListResponse = serde_json::from_str(&response_text)
                .map_err(|e| CalendarApiError::ApiError(format!("JSON parse error: {}", e)))?;

            println!("[DEBUG] Parsed {} items from response", events_response.items.len());

            // Filter out cancelled events
            let active_events = events_response
                .items
                .into_iter()
                .filter(|event| event.status.as_deref() != Some("cancelled"));

            all_events.extend(active_events);

            page_token = events_response.next_page_token;
            if page_token.is_none() {
                break;
            }
        }

        Ok(all_events)
    }
}

impl Default for CalendarClient {
    fn default() -> Self {
        Self::new()
    }
}
