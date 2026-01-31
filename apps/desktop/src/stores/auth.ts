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

/**
 * Register a callback to be called when auth completes (after OAuth callback)
 * Used by accounts store to reload accounts after login
 */
export function onAuthComplete(callback: () => void): void {
  onAuthCompleteCallback = callback;
}

// Server URL from environment
const SYNC_SERVER_URL =
  import.meta.env.VITE_SYNC_SERVER_URL || "http://localhost:5000";

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
      // Validate token with server
      const isValid = await validateSession(token);

      if (isValid) {
        setSessionToken(token);
        setIsAuthenticated(true);
      } else {
        // Token invalid, clear it
        await invoke("clear_session_token");
      }
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
    const stateResponse = await fetch(`${SYNC_SERVER_URL}/auth/state`, {
      method: "POST",
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

    if (response.status === 202) {
      // Still pending, continue polling
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
