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

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * Format a date as a short date string: "Wed, Jan 15"
 * When timeZone is provided, formats the date in that timezone.
 */
export function formatDate(date: Date, timeZone?: string): string {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(timeZone && { timeZone }),
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
 * Get the UTC offset in minutes for a timezone at a given instant.
 * Returns minutes such that local = UTC + offset.
 */
function getUtcOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  }).formatToParts(date);
  const tzPart = parts.find(p => p.type === "timeZoneName")?.value ?? "GMT";
  if (tzPart === "GMT") return 0;
  const match = tzPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const sign = match[1] === "+" ? 1 : -1;
  const hours = parseInt(match[2], 10);
  const minutes = parseInt(match[3] ?? "0", 10);
  return sign * (hours * 60 + minutes);
}

/**
 * Reinterpret a Date's wall-clock time from one timezone to another.
 * Returns a new Date where the wall-clock time in newTz equals the
 * wall-clock time of the original Date in oldTz.
 *
 * Example: 2pm Vienna (UTC+1) reinterpreted to New York (UTC-5) → 8pm Vienna / 2pm New York.
 */
export function reinterpretInTimezone(date: Date, oldTz: string, newTz: string): Date {
  if (oldTz === newTz) return date;
  const oldOffset = getUtcOffsetMinutes(date, oldTz);
  const newOffset = getUtcOffsetMinutes(date, newTz);
  return new Date(date.getTime() + (oldOffset - newOffset) * 60000);
}

/**
 * Set hours and minutes on a Date in a specific timezone.
 * Returns a new Date shifted so that the wall-clock time in `timeZone`
 * equals hours:minutes.
 */
export function setTimeInTimezone(baseDate: Date, hours: number, minutes: number, timeZone: string): Date {
  const current = getHoursAndMinutes(baseDate, timeZone);
  const diffMinutes = (hours * 60 + minutes) - (current.hours * 60 + current.minutes);
  return new Date(baseDate.getTime() + diffMinutes * 60000);
}

/**
 * Parse a time string to hours and minutes with smart AM/PM handling.
 * Accepts many formats:
 * - "5:45 PM" → 17:45
 * - "5:45PMasdfasdf" → 17:45 (strips garbage)
 * - "5p" → 17:00
 * - "17:45" → 17:45 (24h)
 * - "530pm" → 17:30
 * - "12 AM" → 0:00
 * - "" → 0:00 (midnight)
 * Returns null only if no digits are found.
 *
 * When `referenceHour` is provided and the input is ambiguous (hour 1–12
 * with no AM/PM marker and no 24h-style hour), the interpretation closest
 * to the reference hour is chosen. Inspired by zackdever/time.
 * Example: referenceHour=14, input="3" → 15:00 (3 PM, not 3 AM).
 */
export function parseTimeInput(value: string, referenceHour?: number): { hours: number; minutes: number } | null {
  const raw = value.trim();
  if (raw === "") return { hours: 0, minutes: 0 };

  // Detect AM/PM: strip digits, colons, spaces, periods — check what's left
  const nonTime = raw.replace(/[\d:\s.]/g, "").toLowerCase();
  let period: "am" | "pm" | null = null;
  if (nonTime.startsWith("p")) period = "pm";
  else if (nonTime.startsWith("a")) period = "am";

  // Extract only digits and colons for time parsing
  const cleaned = raw.replace(/[^\d:]/g, "");
  if (cleaned === "" || cleaned === ":") return null;

  let hours: number;
  let minutes: number;

  if (cleaned.includes(":")) {
    const parts = cleaned.split(":");
    if (parts.length > 2) return null;
    hours = parts[0] === "" ? 0 : parseInt(parts[0].slice(0, 2), 10) || 0;
    if (hours > 23) hours = parseInt(parts[0][0], 10) || 0;
    minutes = parts[1] === "" ? 0 : Math.min(parseInt(parts[1].slice(0, 2), 10) || 0, 59);
  } else {
    // A time is at most 4 digits (HHMM) — ignore trailing digit garbage
    const capped = cleaned.length > 4 ? cleaned.slice(0, 4) : cleaned;
    const num = parseInt(capped, 10);
    if (isNaN(num)) return null;
    if (capped.length <= 2) {
      if (num > 23) {
        // Not a valid hour — first digit is hour, second is tens of minutes
        // "32" → 3:20, "45" → 4:50
        hours = Math.floor(num / 10);
        minutes = (num % 10) * 10;
      } else {
        hours = num;
        minutes = 0;
      }
    } else {
      // "530" → 5:30, "1230" → 12:30
      hours = Math.floor(num / 100);
      minutes = num % 100;
      if (hours > 23) {
        // 4 digits but invalid hour (e.g. "4444" → 44:44) — use first 3 as H:MM
        // "4444" → "444" → 4:44, "9999" → "999" → 9:59
        const shorter = parseInt(capped.slice(0, 3), 10);
        hours = Math.floor(shorter / 100);
        minutes = shorter % 100;
      }
    }
  }

  // Apply AM/PM only for 12h-style hours (1–12)
  if (period === "am" && hours <= 12) {
    if (hours === 12) hours = 0;
  } else if (period === "pm" && hours <= 12) {
    if (hours < 12) hours += 12;
  } else if (period === null && hours >= 1 && hours <= 12 && referenceHour !== undefined) {
    // Ambiguous 12h input with no AM/PM — pick closest to reference hour.
    // Two candidates: `hours` (AM) and `hours + 12` (PM), except 12 → 0 or 12.
    const amHour = hours === 12 ? 0 : hours;
    const pmHour = hours === 12 ? 12 : hours + 12;
    const distAm = Math.abs(amHour - referenceHour);
    const distPm = Math.abs(pmHour - referenceHour);
    hours = distPm < distAm ? pmHour : amHour;
  }

  hours = Math.min(hours, 23);
  minutes = Math.min(minutes, 59);

  return { hours, minutes };
}
