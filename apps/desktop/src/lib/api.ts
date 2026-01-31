import { sessionToken, logout } from "../stores/auth";

// Server URL from environment
const API_BASE =
  import.meta.env.VITE_SYNC_SERVER_URL || "http://localhost:5000";

/**
 * Error thrown when authentication fails
 */
export class AuthError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Error thrown when API request fails
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Make an authenticated API request to the sync server
 *
 * @param path - API path (e.g., "/api/events")
 * @param options - Fetch options
 * @returns Response data
 * @throws AuthError if not authenticated or session expired
 * @throws ApiError if request fails
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = sessionToken();

  if (!token) {
    throw new AuthError("Not authenticated");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401) {
    // Token expired or invalid, clear session and prompt re-auth
    await logout();
    throw new AuthError("Session expired");
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(
      errorData.error || `Request failed: ${response.statusText}`,
      response.status,
      errorData.code,
    );
  }

  // Handle empty responses
  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text);
}

/**
 * Make an unauthenticated API request (for public endpoints)
 */
export async function publicFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(
      errorData.error || `Request failed: ${response.statusText}`,
      response.status,
      errorData.code,
    );
  }

  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text);
}
