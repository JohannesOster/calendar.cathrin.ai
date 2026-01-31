import { invoke } from "@tauri-apps/api/core";
import type { CalendarAccount } from "../stores/accounts";

/**
 * Start the OAuth flow by opening the browser with the Google authorization URL.
 * This command handles the entire flow:
 * 1. Opens browser with OAuth consent screen
 * 2. Starts local server to receive callback
 * 3. Exchanges code for tokens
 * 4. Fetches user info and calendars
 * 5. Stores account and returns it
 */
export async function startOAuthFlow(): Promise<CalendarAccount> {
  return invoke("start_oauth_flow");
}

/**
 * Get all connected calendar accounts from storage
 */
export async function getConnectedAccounts(): Promise<CalendarAccount[]> {
  return invoke("get_connected_accounts");
}

/**
 * Remove a connected account and clear all its tokens
 */
export async function removeAccount(accountId: string): Promise<void> {
  return invoke("remove_account", { accountId });
}

/**
 * Ensure a valid access token is available for an account
 * Refreshes the token if it's expired or about to expire
 */
export async function ensureValidToken(accountId: string): Promise<string> {
  return invoke("ensure_valid_token", { accountId });
}
