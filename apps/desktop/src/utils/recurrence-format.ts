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

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Parse an RRULE string into key-value pairs.
 * Input: "RRULE:FREQ=WEEKLY;BYDAY=TU" or "FREQ=WEEKLY;BYDAY=TU"
 */
function parseRrule(rrule: string): Record<string, string> {
  const body = rrule.replace(/^RRULE:/, "");
  const parts: Record<string, string> = {};
  for (const pair of body.split(";")) {
    const [key, value] = pair.split("=");
    if (key && value) parts[key] = value;
  }
  return parts;
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

  switch (freq) {
    case "DAILY":
      return interval === 1 ? "Daily" : `Every ${interval} days`;

    case "WEEKLY": {
      const prefix = interval === 1 ? "Weekly" : `Every ${interval} weeks`;
      if (!rule.BYDAY) return prefix;
      const days = rule.BYDAY.split(",");
      if (days.length === 1) {
        return `${prefix} on ${DAY_NAMES[days[0]] ?? days[0]}`;
      }
      const names = days.map(d => DAY_ABBREVS[d] ?? d);
      return `${prefix} on ${names.join(", ")}`;
    }

    case "MONTHLY": {
      const prefix = interval === 1 ? "Monthly" : `Every ${interval} months`;
      return `${prefix} on the ${ordinal(eventStart.getDate())}`;
    }

    case "YEARLY": {
      const prefix = interval === 1 ? "Annually" : `Every ${interval} years`;
      return `${prefix} on ${MONTH_NAMES[eventStart.getMonth()]} ${eventStart.getDate()}`;
    }

    default:
      return "Repeats";
  }
}
