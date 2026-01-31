use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::net::TcpListener;
use std::time::Duration;
use thiserror::Error;
use tiny_http::{Response, Server};
use url::Url;

/// Timeout for waiting for OAuth callback (5 minutes)
const CALLBACK_TIMEOUT_SECS: u64 = 300;

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";

// Scopes for Google Calendar API
const SCOPES: &[&str] = &[
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
];

#[derive(Error, Debug)]
pub enum OAuthError {
    #[error("Token exchange failed: {0}")]
    TokenExchangeFailed(String),
    #[error("Token refresh failed: {0}")]
    TokenRefreshFailed(String),
    #[error("HTTP request failed: {0}")]
    HttpError(#[from] reqwest::Error),
    #[error("URL parse error: {0}")]
    UrlError(#[from] url::ParseError),
    #[error("Missing OAuth credentials")]
    MissingCredentials,
    #[error("Failed to start callback server: {0}")]
    ServerError(String),
    #[error("OAuth flow timed out - no response from browser")]
    Timeout,
}

#[derive(Debug, Clone)]
pub struct OAuthConfig {
    pub client_id: String,
    pub client_secret: String,
}

impl OAuthConfig {
    pub fn from_env() -> Result<Self, OAuthError> {
        let client_id = std::env::var("GOOGLE_CLIENT_ID")
            .or_else(|_| std::env::var("VITE_GOOGLE_CLIENT_ID"))
            .map_err(|_| OAuthError::MissingCredentials)?;
        let client_secret = std::env::var("GOOGLE_CLIENT_SECRET")
            .or_else(|_| std::env::var("VITE_GOOGLE_CLIENT_SECRET"))
            .map_err(|_| OAuthError::MissingCredentials)?;

        Ok(Self {
            client_id,
            client_secret,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
    pub token_type: String,
    pub scope: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PkceChallenge {
    pub verifier: String,
    pub challenge: String,
}

impl PkceChallenge {
    pub fn new() -> Self {
        let verifier = generate_code_verifier();
        let challenge = generate_code_challenge(&verifier);
        Self { verifier, challenge }
    }
}

impl Default for PkceChallenge {
    fn default() -> Self {
        Self::new()
    }
}

/// Generate a cryptographically random code verifier for PKCE
fn generate_code_verifier() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
    URL_SAFE_NO_PAD.encode(&bytes)
}

/// Generate the code challenge from the verifier using SHA256
fn generate_code_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let result = hasher.finalize();
    URL_SAFE_NO_PAD.encode(result)
}

/// Find an available port on the loopback interface
pub fn find_available_port() -> Result<u16, OAuthError> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| OAuthError::ServerError(e.to_string()))?;
    let port = listener
        .local_addr()
        .map_err(|e| OAuthError::ServerError(e.to_string()))?
        .port();
    Ok(port)
}

/// Build the redirect URI for the loopback server
pub fn build_redirect_uri(port: u16) -> String {
    format!("http://127.0.0.1:{}", port)
}

/// Build the Google OAuth authorization URL with PKCE
pub fn build_auth_url(
    config: &OAuthConfig,
    redirect_uri: &str,
    pkce: &PkceChallenge,
) -> Result<String, OAuthError> {
    let mut url = Url::parse(GOOGLE_AUTH_URL)?;

    url.query_pairs_mut()
        .append_pair("client_id", &config.client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", &SCOPES.join(" "))
        .append_pair("code_challenge", &pkce.challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");

    Ok(url.to_string())
}

/// Result of the OAuth callback
#[derive(Debug)]
pub enum CallbackResult {
    Success(String), // Authorization code
    Error(String),   // Error message
}

/// Start a local HTTP server and wait for the OAuth callback with timeout
pub fn wait_for_callback(port: u16) -> Result<CallbackResult, OAuthError> {
    let addr = format!("127.0.0.1:{}", port);
    let server =
        Server::http(&addr).map_err(|e| OAuthError::ServerError(e.to_string()))?;

    // Wait for a single request with timeout (the OAuth callback)
    let timeout = Duration::from_secs(CALLBACK_TIMEOUT_SECS);
    let request = server
        .recv_timeout(timeout)
        .map_err(|e| OAuthError::ServerError(e.to_string()))?
        .ok_or(OAuthError::Timeout)?;

    // Parse the URL to extract query parameters
    let url_str = format!("http://127.0.0.1{}", request.url());
    let url = Url::parse(&url_str).map_err(|e| OAuthError::UrlError(e))?;

    // Look for the authorization code or error
    let mut code: Option<String> = None;
    let mut error: Option<String> = None;

    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.to_string()),
            "error" => error = Some(value.to_string()),
            _ => {}
        }
    }

    // Determine the response to show the user
    let (result, html) = if let Some(auth_code) = code {
        (
            CallbackResult::Success(auth_code),
            success_html(),
        )
    } else if let Some(err) = error {
        let message = match err.as_str() {
            "access_denied" => "You cancelled the authorization. You can close this window.",
            _ => "An error occurred during authorization. Please try again.",
        };
        (
            CallbackResult::Error(err),
            error_html(message),
        )
    } else {
        (
            CallbackResult::Error("No authorization code received".to_string()),
            error_html("No authorization code received. Please try again."),
        )
    };

    // Send HTML response to the browser
    let response = Response::from_string(html)
        .with_header(
            tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
                .unwrap(),
        );
    let _ = request.respond(response);

    Ok(result)
}

fn success_html() -> String {
    r#"<!DOCTYPE html>
<html>
<head>
    <title>Authorization Successful</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
            text-align: center;
            background: white;
            padding: 3rem;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            max-width: 400px;
        }
        .checkmark {
            width: 80px;
            height: 80px;
            margin: 0 auto 1.5rem;
            background: #10b981;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .checkmark svg {
            width: 40px;
            height: 40px;
            stroke: white;
            stroke-width: 3;
        }
        h1 { color: #1f2937; margin: 0 0 0.5rem; font-size: 1.5rem; }
        p { color: #6b7280; margin: 0; }
    </style>
</head>
<body>
    <div class="container">
        <div class="checkmark">
            <svg viewBox="0 0 24 24" fill="none">
                <path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </div>
        <h1>Authorization Successful!</h1>
        <p>You can close this window and return to the app.</p>
    </div>
</body>
</html>"#.to_string()
}

fn error_html(message: &str) -> String {
    format!(r#"<!DOCTYPE html>
<html>
<head>
    <title>Authorization Failed</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #f87171 0%, #dc2626 100%);
        }}
        .container {{
            text-align: center;
            background: white;
            padding: 3rem;
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            max-width: 400px;
        }}
        .error-icon {{
            width: 80px;
            height: 80px;
            margin: 0 auto 1.5rem;
            background: #ef4444;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
        }}
        .error-icon svg {{
            width: 40px;
            height: 40px;
            stroke: white;
            stroke-width: 3;
        }}
        h1 {{ color: #1f2937; margin: 0 0 0.5rem; font-size: 1.5rem; }}
        p {{ color: #6b7280; margin: 0; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="error-icon">
            <svg viewBox="0 0 24 24" fill="none">
                <path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </div>
        <h1>Authorization Failed</h1>
        <p>{}</p>
    </div>
</body>
</html>"#, message)
}

/// Exchange the authorization code for access and refresh tokens
pub async fn exchange_code_for_tokens(
    config: &OAuthConfig,
    redirect_uri: &str,
    code: &str,
    code_verifier: &str,
) -> Result<TokenResponse, OAuthError> {
    let client = Client::new();

    let params = [
        ("client_id", config.client_id.as_str()),
        ("client_secret", config.client_secret.as_str()),
        ("code", code),
        ("code_verifier", code_verifier),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri),
    ];

    let response = client.post(GOOGLE_TOKEN_URL).form(&params).send().await?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(OAuthError::TokenExchangeFailed(error_text));
    }

    let token_response: TokenResponse = response.json().await?;
    Ok(token_response)
}

/// Refresh an expired access token using the refresh token
pub async fn refresh_access_token(
    config: &OAuthConfig,
    refresh_token: &str,
) -> Result<TokenResponse, OAuthError> {
    let client = Client::new();

    let params = [
        ("client_id", config.client_id.as_str()),
        ("client_secret", config.client_secret.as_str()),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];

    let response = client.post(GOOGLE_TOKEN_URL).form(&params).send().await?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(OAuthError::TokenRefreshFailed(error_text));
    }

    let token_response: TokenResponse = response.json().await?;
    Ok(token_response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pkce_challenge_generation() {
        let pkce = PkceChallenge::new();
        assert!(!pkce.verifier.is_empty());
        assert!(!pkce.challenge.is_empty());
        assert_ne!(pkce.verifier, pkce.challenge);
    }

    #[test]
    fn test_code_verifier_length() {
        let verifier = generate_code_verifier();
        // Base64 encoding of 32 bytes should be 43 characters
        assert_eq!(verifier.len(), 43);
    }

    #[test]
    fn test_find_available_port() {
        let port = find_available_port().unwrap();
        assert!(port > 0);
    }
}
