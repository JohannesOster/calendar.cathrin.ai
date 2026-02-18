import { RRule } from "rrule";

export interface ExpandedInstance {
  start: Date;
  end: Date;
}

function toFakeUTC(d: Date): Date {
  return new Date(Date.UTC(
    d.getFullYear(), d.getMonth(), d.getDate(),
    d.getHours(), d.getMinutes(), d.getSeconds(),
  ));
}

function fromFakeUTC(d: Date): Date {
  return new Date(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(),
  );
}

/** Parse iCal date string (20260217, 20260217T120000, 20260217T120000Z) into epoch ms. */
function parseICalDate(s: string): number {
  if (/^\d{8}$/.test(s)) {
    const y = +s.slice(0, 4), m = +s.slice(4, 6) - 1, d = +s.slice(6, 8);
    return Date.UTC(y, m, d);
  }
  if (/^\d{8}T\d{6}$/.test(s)) {
    const d = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    const t = `${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}`;
    return new Date(`${d}T${t}`).getTime();
  }
  if (/^\d{8}T\d{6}Z$/.test(s)) {
    const d = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    const t = `${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}`;
    return new Date(`${d}T${t}Z`).getTime();
  }
  return new Date(s).getTime();
}

interface ParsedExdates {
  exactMs: Set<number>;
  dateOnly: Set<string>; // "YYYY-MM-DD" for VALUE=DATE exclusions
}

/**
 * Parse EXDATE strings into exact timestamps and date-only strings.
 * Date-only EXDATEs (VALUE=DATE:20260217) match any occurrence on that day.
 */
function parseExdates(rruleStrings: string[]): ParsedExdates {
  const exactMs = new Set<number>();
  const dateOnly = new Set<string>();

  for (const str of rruleStrings) {
    if (!str.startsWith("EXDATE")) continue;
    const colonIdx = str.indexOf(":");
    if (colonIdx === -1) continue;
    const isDateOnly = str.includes("VALUE=DATE") && !str.includes("VALUE=DATE-TIME");
    const values = str.slice(colonIdx + 1);
    for (const v of values.split(",")) {
      const trimmed = v.trim();
      if (!trimmed) continue;
      if (isDateOnly || /^\d{8}$/.test(trimmed)) {
        const y = trimmed.slice(0, 4);
        const m = trimmed.slice(4, 6);
        const d = trimmed.slice(6, 8);
        dateOnly.add(`${y}-${m}-${d}`);
      } else {
        const ts = parseICalDate(trimmed);
        if (!isNaN(ts)) exactMs.add(ts);
      }
    }
  }
  return { exactMs, dateOnly };
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Expand an RRULE into occurrences within a visible range around a center date.
 * Returns start/end pairs for each occurrence (excluding the dtstart occurrence itself).
 *
 * Handles EXDATE exclusions and uses UTC floating-time workaround to avoid
 * DST-induced hour shifts in the rrule library.
 */
export function expandRRule(
  rruleStrings: string[],
  dtstart: Date,
  durationMs: number,
  centerDate: Date,
): ExpandedInstance[] {
  const rruleStr = rruleStrings.find(r => r.startsWith("RRULE:") || r.startsWith("FREQ="));
  if (!rruleStr) return [];

  const rangeStart = new Date(centerDate);
  rangeStart.setDate(rangeStart.getDate() - 30);
  const rangeEnd = new Date(centerDate);
  rangeEnd.setDate(rangeEnd.getDate() + 60);

  const excluded = parseExdates(rruleStrings);

  const rule = RRule.fromString(rruleStr.replace(/^RRULE:/, ""));
  const ruleWithStart = new RRule({
    ...rule.origOptions,
    dtstart: toFakeUTC(dtstart),
  });

  const utcOccurrences = ruleWithStart.between(toFakeUTC(rangeStart), toFakeUTC(rangeEnd), true);
  const instances: ExpandedInstance[] = [];

  for (const utcOcc of utcOccurrences) {
    const occ = fromFakeUTC(utcOcc);

    // Skip the master occurrence (±60s tolerance for edge cases)
    if (Math.abs(occ.getTime() - dtstart.getTime()) < 60_000) continue;

    // Skip EXDATE-excluded occurrences
    if (excluded.exactMs.has(occ.getTime())) continue;
    if (excluded.dateOnly.has(toDateKey(occ))) continue;

    instances.push({
      start: occ,
      end: new Date(occ.getTime() + durationMs),
    });
  }

  return instances;
}
