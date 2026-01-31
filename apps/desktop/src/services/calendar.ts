import { invoke } from "@tauri-apps/api/core";
import type { CalendarAccount } from "../stores/accounts";

/**
 * Toggle the visibility of a calendar
 */
export async function toggleCalendarVisibility(
  accountId: string,
  calendarId: string,
  visible: boolean
): Promise<void> {
  return invoke("toggle_calendar_visibility", {
    accountId,
    calendarId,
    visible,
  });
}

/**
 * Refresh calendars for an account (fetches latest from Google)
 */
export async function refreshAccountCalendars(
  accountId: string
): Promise<CalendarAccount> {
  return invoke("refresh_account_calendars", { accountId });
}
