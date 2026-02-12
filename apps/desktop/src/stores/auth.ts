import { createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

// Session state
const [sessionToken, setSessionToken] = createSignal<string | null>(null);
const [isAuthenticated, setIsAuthenticated] = createSignal(false);
const [isAuthLoading, setIsAuthLoading] = createSignal(false);
const [authError, setAuthError] = createSignal<string | null>(null);

// Export readable signals
export { sessionToken, isAuthenticated, isAuthLoading, authError };

// Callback for when auth completes (used by accounts store to reload)
let onAuthCompleteCallback: (() => void) | null = null;
let onLogoutCallback: (() => void) | null = null;

/**
 * Register a callback to be called when auth completes (after OAuth callback)
 * Used by accounts store to reload accounts after login
 */
export function onAuthComplete(callback: () => void): void {
  onAuthCompleteCallback = callback;
}

/**
 * Register a callback to be called on logout (e.g., clear caches)
 */
export function onLogout(callback: () => void): void {
  onLogoutCallback = callback;
}

// Server URL from environment — use VITE_SYNC_PORT for dev convenience,
// VITE_SYNC_SERVER_URL for full override (e.g. production)
const SYNC_SERVER_URL =
  import.meta.env.VITE_SYNC_SERVER_URL ||
  (import.meta.env.VITE_SYNC_PORT
    ? `http://localhost:${import.meta.env.VITE_SYNC_PORT}`
    : "http://localhost:3000");

/**
 * Initialize auth state on app startup
 * Loads stored session token and validates it with the server
 */
export async function initAuth(): Promise<void> {
  setIsAuthLoading(true);
  setAuthError(null);

  try {
    // Load token from secure storage
    const token = await invoke<string | null>("get_session_token");

    if (token) {
      // Set authenticated optimistically so accounts/events can load in parallel.
      // If invalid, apiFetch() handles 401 → logout(). Background validation is
      // a secondary safety net for edge cases where no API call is made.
      setSessionToken(token);
      setIsAuthenticated(true);

      validateSession(token).then((isValid) => {
        if (!isValid) {
          console.warn("[auth] Session invalid, clearing");
          setSessionToken(null);
          setIsAuthenticated(false);
          invoke("clear_session_token").catch(() => {});
        }
      }).catch(() => {
        // Network error — stay authenticated for offline use
      });
    }
  } catch (error) {
    console.error("Failed to initialize auth:", error);
    setAuthError(
      error instanceof Error ? error.message : "Failed to initialize auth",
    );
  } finally {
    setIsAuthLoading(false);
  }
}

/**
 * Validate a session token with the server
 */
async function validateSession(token: string): Promise<boolean> {
  try {
    const response = await fetch(`${SYNC_SERVER_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return response.ok;
  } catch {
    // Network error - assume token is valid for offline use
    return true;
  }
}

/**
 * Start the OAuth flow by opening the browser to the server's OAuth endpoint
 * Uses a state-based polling mechanism for the callback
 */
export async function startServerOAuth(): Promise<void> {
  setIsAuthLoading(true);
  setAuthError(null);

  try {
    // Step 1: Create a pending state on the server
    // If already authenticated, pass the token so the server links the new
    // account to the existing user instead of creating a new one
    const headers: Record<string, string> = {};
    const currentToken = sessionToken();
    if (currentToken) {
      headers["Authorization"] = `Bearer ${currentToken}`;
    }

    const stateResponse = await fetch(`${SYNC_SERVER_URL}/auth/state`, {
      method: "POST",
      headers,
    });

    if (!stateResponse.ok) {
      throw new Error("Failed to create OAuth state");
    }

    const { state } = await stateResponse.json();

    // Step 2: Open browser to start OAuth flow
    await invoke("open_url", {
      url: `${SYNC_SERVER_URL}/auth/start?state=${state}`,
    });

    // Step 3: Poll for the token
    const token = await pollForToken(state);

    // Step 4: Handle the callback
    await handleAuthCallback(token);
  } catch (error) {
    console.error("Failed to complete OAuth:", error);
    setAuthError(
      error instanceof Error ? error.message : "Failed to complete OAuth",
    );
    setIsAuthLoading(false);
  }
}

/**
 * Poll the server for the OAuth token
 * Returns when the token is available or times out
 */
async function pollForToken(state: string): Promise<string> {
  const maxAttempts = 120; // 2 minutes at 1 second intervals
  const pollInterval = 1000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const response = await fetch(
      `${SYNC_SERVER_URL}/auth/poll?state=${state}`,
    );

    if (response.status === 202 || response.status === 404) {
      // 202 = still pending, 404 = state transiently missing (race between
      // /auth/start consuming it and callback re-creating it). Both cases:
      // keep polling.
      continue;
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "OAuth failed");
    }

    const data = await response.json();
    if (data.token) {
      return data.token;
    }
  }

  throw new Error("OAuth timed out - please try again");
}

/**
 * Handle the OAuth callback with the session token
 * Called when the app receives a deep link with the token
 */
export async function handleAuthCallback(token: string): Promise<void> {
  try {
    // Store token securely
    await invoke("save_session_token", { token });

    setSessionToken(token);
    setIsAuthenticated(true);
    setAuthError(null);

    // Notify listeners that auth completed (e.g., accounts store reloads)
    onAuthCompleteCallback?.();
  } catch (error) {
    console.error("Failed to save session token:", error);
    setAuthError(
      error instanceof Error ? error.message : "Failed to save session",
    );
  } finally {
    setIsAuthLoading(false);
  }
}

/**
 * Log out and clear the session
 */
export async function logout(): Promise<void> {
  const token = sessionToken();

  try {
    // Clear local state first
    setSessionToken(null);
    setIsAuthenticated(false);
    onLogoutCallback?.();
    await invoke("clear_session_token");

    // Try to invalidate session on server (best effort)
    if (token) {
      try {
        await fetch(`${SYNC_SERVER_URL}/auth/logout`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      } catch {
        // Ignore server errors during logout
      }
    }
  } catch (error) {
    console.error("Failed to logout:", error);
  }
}

/**
 * Get the current user info from the server
 */
export async function getCurrentUser(): Promise<{
  id: string;
  email: string;
} | null> {
  const token = sessionToken();
  if (!token) return null;

  try {
    const response = await fetch(`${SYNC_SERVER_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Session expired, logout
        await logout();
      }
      return null;
    }

    return response.json();
  } catch {
    return null;
  }
}
