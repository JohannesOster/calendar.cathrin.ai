/**
 * Dirty-flag system for recurring event series.
 *
 * Replaces the time-based RRULE_PROTECTION_MS window. A series is marked
 * dirty when the client mutates its recurrence, and stays dirty until the
 * server confirms the mutation AND revalidation returns matching data.
 * This handles providers with eventual consistency (Outlook: minutes to hours).
 */

interface DirtyEntry {
  optimisticInstances: Set<string>;
  expectedRecurrence: string[];
  confirmedByServer: boolean;
}

const dirtySeries = new Map<string, DirtyEntry>();

export function markSeriesDirty(
  seriesId: string,
  instanceIds: string[],
  recurrence: string[],
): void {
  dirtySeries.set(seriesId, {
    optimisticInstances: new Set(instanceIds),
    expectedRecurrence: recurrence,
    confirmedByServer: false,
  });
}

export function markServerConfirmed(seriesId: string): void {
  const entry = dirtySeries.get(seriesId);
  if (entry) {
    entry.confirmedByServer = true;
  }
}

export function isSeriesDirty(seriesId: string): boolean {
  return dirtySeries.has(seriesId);
}

export function clearDirty(seriesId: string): void {
  dirtySeries.delete(seriesId);
}

/**
 * Clear the dirty flag if the server returned recurrence matching our expectation
 * AND the server has already confirmed the mutation.
 */
export function clearDirtyIfMatching(
  seriesId: string,
  serverRecurrence: string[],
): void {
  const entry = dirtySeries.get(seriesId);
  if (!entry || !entry.confirmedByServer) return;

  const normalize = (r: string[]) => r.map(s => s.trim()).sort();
  const matches =
    entry.expectedRecurrence.length === serverRecurrence.length &&
    JSON.stringify(normalize(entry.expectedRecurrence)) === JSON.stringify(normalize(serverRecurrence));

  if (matches) {
    dirtySeries.delete(seriesId);
  }
}
