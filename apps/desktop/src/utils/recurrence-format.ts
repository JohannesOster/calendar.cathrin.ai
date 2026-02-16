const DAY_NAMES: Record<string, string> = {
  SU: "Sunday", MO: "Monday", TU: "Tuesday", WE: "Wednesday",
  TH: "Thursday", FR: "Friday", SA: "Saturday",
};

const DAY_ABBREVS: Record<string, string> = {
  SU: "Sun", MO: "Mon", TU: "Tue", WE: "Wed",
  TH: "Thu", FR: "Fri", SA: "Sat",
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Day codes in calendar order (Sunday first) */
export const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
export type DayCode = typeof DAY_CODES[number];

/** Day code for a JS Date (0=Sunday → SU, 1=Monday → MO, etc.) */
export function dayCodeFromDate(date: Date): DayCode {
  return DAY_CODES[date.getDay()];
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Parse an RRULE string into key-value pairs.
 * Input: "RRULE:FREQ=WEEKLY;BYDAY=TU" or "FREQ=WEEKLY;BYDAY=TU"
 */
export function parseRrule(rrule: string): Record<string, string> {
  const body = rrule.replace(/^RRULE:/, "");
  const parts: Record<string, string> = {};
  for (const pair of body.split(";")) {
    const [key, value] = pair.split("=");
    if (key && value) parts[key] = value;
  }
  return parts;
}

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type EndCondition =
  | { type: "never" }
  | { type: "date"; date: Date }
  | { type: "count"; count: number };

export interface RecurrenceConfig {
  freq: Frequency;
  interval: number;
  byDay?: DayCode[];
  end: EndCondition;
}

/**
 * Build an RRULE string array from a RecurrenceConfig.
 */
export function buildRrule(config: RecurrenceConfig, eventStart: Date): string[] {
  const parts: string[] = [`FREQ=${config.freq}`];

  if (config.interval > 1) {
    parts.push(`INTERVAL=${config.interval}`);
  }

  if (config.freq === "WEEKLY" && config.byDay && config.byDay.length > 0) {
    parts.push(`BYDAY=${config.byDay.join(",")}`);
  }

  if (config.freq === "MONTHLY") {
    parts.push(`BYMONTHDAY=${eventStart.getDate()}`);
  }

  if (config.end.type === "count") {
    parts.push(`COUNT=${config.end.count}`);
  } else if (config.end.type === "date") {
    const d = config.end.date;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    parts.push(`UNTIL=${y}${m}${day}T235959Z`);
  }

  return [`RRULE:${parts.join(";")}`];
}

/**
 * Convert an RRULE string array to a human-readable summary.
 * Uses the event's start date to derive "on the 15th" / "on Feb 13" for MONTHLY/YEARLY.
 */
export function formatRecurrence(recurrence: string[], eventStart: Date): string {
  const rruleStr = recurrence.find(r => r.startsWith("RRULE:") || r.startsWith("FREQ="));
  if (!rruleStr) return "Repeats";

  const rule = parseRrule(rruleStr);
  const freq = rule.FREQ;
  const interval = rule.INTERVAL ? parseInt(rule.INTERVAL) : 1;

  let base: string;

  switch (freq) {
    case "DAILY":
      base = interval === 1 ? "Daily" : `Every ${interval} days`;
      break;

    case "WEEKLY": {
      const prefix = interval === 1 ? "Weekly" : `Every ${interval} weeks`;
      if (!rule.BYDAY) {
        base = prefix;
        break;
      }
      const days = rule.BYDAY.split(",");
      if (days.length === 5 && ["MO", "TU", "WE", "TH", "FR"].every(d => days.includes(d))) {
        base = interval === 1 ? "Every weekday" : `Every ${interval} weeks on weekdays`;
        break;
      }
      if (days.length === 1) {
        base = `${prefix} on ${DAY_NAMES[days[0]] ?? days[0]}`;
      } else {
        const names = days.map(d => DAY_ABBREVS[d] ?? d);
        base = `${prefix} on ${names.join(", ")}`;
      }
      break;
    }

    case "MONTHLY": {
      const prefix = interval === 1 ? "Monthly" : `Every ${interval} months`;
      base = `${prefix} on the ${ordinal(eventStart.getDate())}`;
      break;
    }

    case "YEARLY": {
      const prefix = interval === 1 ? "Annually" : `Every ${interval} years`;
      base = `${prefix} on ${MONTH_NAMES[eventStart.getMonth()]} ${eventStart.getDate()}`;
      break;
    }

    default:
      return "Repeats";
  }

  // Append end condition
  if (rule.COUNT) {
    base += `, ${rule.COUNT} times`;
  } else if (rule.UNTIL) {
    // Parse UNTIL date: YYYYMMDDTHHMMSSZ or YYYYMMDD
    const u = rule.UNTIL.replace(/[TZ]/g, "");
    const year = u.slice(0, 4);
    const month = parseInt(u.slice(4, 6)) - 1;
    const day = u.slice(6, 8);
    base += `, until ${MONTH_NAMES[month]} ${parseInt(day)}, ${year}`;
  }

  return base;
}
