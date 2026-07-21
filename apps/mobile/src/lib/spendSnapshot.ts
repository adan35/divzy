import { startOfMonth, subMonths } from 'date-fns';

/**
 * WI-036 — pure helpers backing the mobile SpendSnapshotChart. Extracted per
 * the established convention (RN screens/components have no render-test
 * harness; nontrivial branching lives in tested src/lib/*.ts modules).
 */

/**
 * Fixed internal 3-month range: `from` = UTC start of the month two
 * calendar months before `now`'s month; `to` = `now` (ISO instant). Not
 * user-configurable — matches the server's existing `monthGrid(from, to)`
 * to yield exactly the 3 zero-filled month buckets the chart renders
 * (spec-WI-036 § Data source & fetch contract).
 */
export function spendSnapshotRange(now: Date = new Date()): { from: string; to: string } {
  const from = startOfMonth(subMonths(now, 2));
  return { from: from.toISOString(), to: now.toISOString() };
}

export interface SpendSnapshotMonth {
  amount: number;
}

export interface SpendSnapshotData {
  yourSpend: number;
  byMonth: SpendSnapshotMonth[];
}

/**
 * Zero-spend state (spec-WI-036 § Rendering): `yourSpend === 0` AND every
 * in-range `byMonth[].amount` is also 0. `undefined` means "still
 * loading/no data yet" — never treated as the zero-spend empty state (the
 * loading branch owns that instead).
 */
export function isSpendSnapshotEmpty(data: SpendSnapshotData | undefined): boolean {
  if (!data) return false;
  return data.yourSpend === 0 && data.byMonth.every((m) => m.amount === 0);
}
