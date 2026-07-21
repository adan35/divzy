import { foldRows, type BreakdownRowDatum } from '@/components/analytics/breakdown-rows';

/** The subset of an `AnalyticsSummaryDto['byGroup']` entry this module needs. */
export interface GroupSpendEntry {
  groupId: string;
  name: string;
  emoji: string;
  amount: number;
}

export interface GroupSpendChartRow extends BreakdownRowDatum {
  /** True only for the single highest-spend bar (index 0 of the fold-preserved,
   * already amount-desc-sorted input) — the explicit visual-highlight cue,
   * spec-WI-060 §1. */
  isHighlight: boolean;
}

/**
 * WI-060 — pure data-shaping for the web `GroupSpendChart`, extracted out of
 * JSX so its branching is unit-testable (recharts' `ResponsiveContainer`
 * renders zero-size, and therefore no `<Cell>`/bar output at all, under
 * jsdom — confirmed empirically; see test-plan-WI-060.md — so this logic
 * cannot be asserted via a rendered-DOM test the way the rest of the
 * component's states can).
 *
 * `byGroup` is consumed verbatim (already converted, zero-filtered, and
 * amount-desc sorted server-side, charter invariant 5) — no re-aggregation,
 * no re-sort, no currency conversion. Only `foldRows`'s existing >8 "Other"
 * convention and the emoji+label join are applied. `isHighlight` is flagged
 * on index 0 of the *folded* output, matching the component's Cell-fill rule
 * (`i === 0 ? 'var(--brand)' : 'var(--surface-2)'`) — folding never reorders,
 * so the top entry stays at index 0 and is never folded away.
 */
export function buildGroupSpendChartRows(byGroup: GroupSpendEntry[]): GroupSpendChartRow[] {
  const rows: BreakdownRowDatum[] = byGroup.map((g) => ({
    key: g.groupId,
    label: g.name,
    emoji: g.emoji,
    amount: g.amount,
  }));
  return foldRows(rows).map((r, i) => ({ ...r, isHighlight: i === 0 }));
}

/**
 * WI-068 (spec §8.2) — single-series bar fill: the one highlighted
 * (top-spend) bar uses `--chart-1` (never `--brand`, which is reserved for
 * interactive text/icons per the retune), every other bar stays the muted
 * `--surface-2` wash. Extracted so the highlight/non-highlight color
 * decision is unit-testable independent of Recharts' zero-size jsdom
 * rendering (see the module doc-comment above).
 */
export function groupSpendBarFill(isHighlight: boolean): string {
  return isHighlight ? 'var(--chart-1)' : 'var(--surface-2)';
}

/** Zero groups with nonzero spend — the server already zero-filters `byGroup`,
 * so an empty array IS the "no group spend yet" case (spec-WI-060 §4).
 * `undefined` means "no data yet" (still loading/error) and is never treated
 * as empty — those branches are handled separately by the component. */
export function isGroupSpendEmpty(byGroup: GroupSpendEntry[] | undefined): boolean {
  if (!byGroup) return false;
  return byGroup.length === 0;
}
