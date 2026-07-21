/**
 * WI-059 — pure helpers backing the mobile GroupMonthlyChart. Extracted per
 * the established convention (RN screens/components have no render-test
 * harness; nontrivial branching lives in tested src/lib/*.ts modules — see
 * the sibling apps/mobile/src/lib/groupSpendChart.ts precedent, WI-060).
 */

/** The subset of an `AnalyticsSummaryDto['byMonth']` entry this module needs. */
export interface GroupMonthlyEntry {
  month: string;
  /** The viewer's own converted share — NEVER plotted by this chart (D1). */
  amount: number;
  /** The group-wide total for the month — the load-bearing field (D1). */
  totalActivity: number;
}

export interface GroupMonthlyBar {
  month: string;
  totalActivity: number;
  /** Bar height in px within the fixed bar-area height passed to `groupMonthlyBars`. */
  height: number;
}

/**
 * True when at least one month's `totalActivity` (never `amount` — D1) is
 * nonzero. Backs D6: the chart renders nothing in an all-zero/broken state,
 * additive above the existing totals list only when there's real data.
 */
export function hasNonZeroMonth(byMonth: GroupMonthlyEntry[]): boolean {
  return byMonth.some((m) => m.totalActivity > 0);
}

/**
 * Builds per-bar render data in the exact chronological order `byMonth` is
 * given (already zero-filled server-side via `monthGrid` — no re-sort, no
 * skipping): height proportional to `totalActivity / max` over a fixed
 * `areaHeight`, floored to a 2px sliver for a zero month and a 4px minimum
 * otherwise so no bar fully disappears (mirrors `groupSpendChart.ts`'s
 * `groupSpendBars`, D5).
 */
export function groupMonthlyBars(byMonth: GroupMonthlyEntry[], areaHeight: number): GroupMonthlyBar[] {
  const max = byMonth.reduce((acc, m) => Math.max(acc, m.totalActivity), 0);
  return byMonth.map((m) => ({
    month: m.month,
    totalActivity: m.totalActivity,
    height:
      max > 0 && m.totalActivity > 0
        ? Math.max(4, Math.round((m.totalActivity / max) * areaHeight))
        : 2,
  }));
}
