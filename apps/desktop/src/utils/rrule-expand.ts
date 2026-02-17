import { RRule } from "rrule";

export interface ExpandedInstance {
  start: Date;
  end: Date;
}

/**
 * Expand an RRULE into occurrences within a visible range around a center date.
 * Returns start/end pairs for each occurrence (excluding the dtstart occurrence itself).
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

  const rule = RRule.fromString(rruleStr.replace(/^RRULE:/, ""));
  const ruleWithStart = new RRule({
    ...rule.origOptions,
    dtstart,
  });

  const occurrences = ruleWithStart.between(rangeStart, rangeEnd, true);
  const instances: ExpandedInstance[] = [];

  for (const occ of occurrences) {
    // Skip the master occurrence
    if (occ.getTime() === dtstart.getTime()) continue;
    instances.push({
      start: occ,
      end: new Date(occ.getTime() + durationMs),
    });
  }

  return instances;
}
