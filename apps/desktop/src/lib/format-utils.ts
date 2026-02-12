/**
 * Consolidated time/date formatting utilities used across calendar components.
 */

/**
 * Extract hours and minutes from a Date, optionally in a specific IANA timezone.
 * Without timezone, uses the local system timezone via Date.getHours/getMinutes.
 */
function getHoursAndMinutes(date: Date, timeZone?: string): { hours: number; minutes: number } {
  if (!timeZone) return { hours: date.getHours(), minutes: date.getMinutes() };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date);
  const hours = parseInt(parts.find(p => p.type === "hour")?.value ?? "0", 10);
  const minutes = parseInt(parts.find(p => p.type === "minute")?.value ?? "0", 10);
  return { hours: hours === 24 ? 0 : hours, minutes };
}

/**
 * Format a Date to a 12-hour display string for the EventForm.
 * Includes a space before AM/PM: "9 AM", "2:30 PM"
 * When timeZone is provided, displays the time in that timezone.
 */
export function formatTime(date: Date, timeZone?: string): string {
  const { hours, minutes } = getHoursAndMinutes(date, timeZone);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  if (minutes === 0) return `${displayHour} ${period}`;
  return `${displayHour}:${minutes.toString().padStart(2, "0")} ${period}`;
}

/**
 * Format a Date to a compact 12-hour string (no space before AM/PM).
 * Used on calendar event chips: "9AM", "2:30PM"
 * When timeZone is provided, displays the time in that timezone.
 */
export function formatCompactTime(date: Date, timeZone?: string): string {
  const { hours, minutes } = getHoursAndMinutes(date, timeZone);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  if (minutes === 0) return `${displayHour}${period}`;
  return `${displayHour}:${minutes.toString().padStart(2, "0")}${period}`;
}

/**
 * Format a time range using compact format: "9AM – 10AM"
 * When timeZone is provided, displays times in that timezone.
 */
export function formatTimeRange(start: Date, end: Date, timeZone?: string): string {
  return `${formatCompactTime(start, timeZone)} – ${formatCompactTime(end, timeZone)}`;
}

/**
 * Get the short timezone abbreviation (e.g., "EST", "PST") for a given IANA timezone.
 */
export function getTimezoneAbbr(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(date);
  return parts.find(p => p.type === "timeZoneName")?.value ?? "";
}

/**
 * Format a Date to an ultra-compact 12-hour string for all-day chip time indicators.
 * Uses lowercase single-letter period: "2p", "2:30p", "11a"
 */
export function formatChipTime(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? "p" : "a";
  const displayHour = hours % 12 || 12;
  if (minutes === 0) return `${displayHour}${period}`;
  return `${displayHour}:${minutes.toString().padStart(2, "0")}${period}`;
}

/**
 * Format a compact time range for all-day chip display: "2p–4p", "2:30p–11a"
 */
export function formatChipTimeRange(start: Date, end: Date): string {
  return `${formatChipTime(start)}–${formatChipTime(end)}`;
}

/**
 * Format the duration between two dates: "1h", "30min", "1h 30min"
 */
export function formatDuration(start: Date, end: Date): string {
  const diffMs = end.getTime() - start.getTime();
  const totalMinutes = Math.round(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}

/**
 * Format a date as a short date string: "Wed, Jan 15"
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Format a date range for all-day events: "Jan 15" or "Jan 15 – Jan 17"
 */
export function formatDateRange(start: Date, end: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
  };
  const startStr = start.toLocaleDateString(undefined, options);
  const endStr = end.toLocaleDateString(undefined, options);

  if (startStr === endStr) return startStr;
  return `${startStr} – ${endStr}`;
}

/**
 * Convert Date to "H:MM" display string for the time text input.
 */
export function toTimeText(date: Date): string {
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Parse a partial time string to hours and minutes.
 * Rules:
 * - Empty -> 0:00 (midnight)
 * - "12:1" -> 12:01 (minutes are the literal number, not left-shifted)
 * - "9" -> 9:00
 * - "13:5" -> 13:05
 * - "25" -> clamped to 23
 * Returns null only if the input contains non-numeric/non-colon characters.
 */
export function parseTimeInput(value: string): { hours: number; minutes: number } | null {
  const trimmed = value.trim();
  if (trimmed === "") return { hours: 0, minutes: 0 };

  // Allow only digits and one colon
  if (!/^[\d:]*$/.test(trimmed)) return null;

  const parts = trimmed.split(":");
  if (parts.length > 2) return null;

  const hourStr = parts[0];
  const minStr = parts[1] ?? "";

  const hours = hourStr === "" ? 0 : Math.min(parseInt(hourStr, 10) || 0, 23);
  const minutes = minStr === "" ? 0 : Math.min(parseInt(minStr, 10) || 0, 59);

  return { hours, minutes };
}
