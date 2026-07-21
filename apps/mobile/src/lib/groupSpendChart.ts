/**
 * WI-060 — pure helpers backing the mobile GroupSpendChart. Extracted per
 * the established convention (RN screens/components have no render-test
 * harness; nontrivial branching lives in tested src/lib/*.ts modules).
 */

/** The subset of an `AnalyticsSummaryDto['byGroup']` entry this module needs. */
export interface GroupSpendEntry {
  groupId: string;
  name: string;
  emoji: string;
  amount: number;
}

export interface GroupSpendBar extends GroupSpendEntry {
  /** Bar height in px within the fixed bar-area height passed to `groupSpendBars`. */
  height: number;
  /** True only for index 0 — the highest-spend group. */
  isHighlight: boolean;
}

/**
 * Zero/empty-groups state (spec-WI-060 §4): the server already zero-filters
 * `byGroup`, so an empty array IS "no groups with nonzero spend" — no
 * further checking needed. `undefined` means "still loading/no data yet" —
 * never treated as the empty state (the loading branch owns that instead).
 */
export function isGroupSpendEmpty(byGroup: GroupSpendEntry[] | undefined): boolean {
  if (!byGroup) return false;
  return byGroup.length === 0;
}

/** Emoji for the synthetic "Other" bucket produced by `foldGroupSpend`,
 * matching the expense-category OTHER convention (`packages/shared/src/constants.ts`). */
const FOLD_OTHER_EMOJI = '📦';

/**
 * Fold everything past the top `max - 1` ranked groups into a single "Other"
 * bucket, mirroring web's `foldRows` (`apps/web/src/components/analytics/breakdown-rows.tsx`)
 * and this app's own `byCategory` fold on the analytics screen
 * (`app/analytics.tsx` — top 7 + synthetic OTHER row past 8 categories):
 * >max rows -> keep the top `max - 1` + one "Other" bucket summing the rest
 * = `max` rows total. `byGroup` is already amount-desc sorted server-side
 * (spec-WI-060 §2/§3), so this never reorders — the highest-spend group at
 * index 0 always survives the fold.
 */
export function foldGroupSpend(byGroup: GroupSpendEntry[], max = 8): GroupSpendEntry[] {
  if (byGroup.length <= max) return byGroup;
  const kept = byGroup.slice(0, max - 1);
  const rest = byGroup.slice(max - 1);
  const otherTotal = rest.reduce((acc, g) => acc + g.amount, 0);
  return [
    ...kept,
    { groupId: '__other__', name: 'Other', emoji: FOLD_OTHER_EMOJI, amount: otherTotal },
  ];
}

/**
 * Builds per-bar render data: height proportional to `amount / max` over a
 * fixed `areaHeight` (mirrors the `BAR_AREA_HEIGHT` idiom used by
 * `analytics.tsx` / `SpendSnapshotChart`), floored to a 2px sliver for a
 * zero amount and a 4px minimum otherwise so no bar fully disappears. Only
 * index 0 is flagged `isHighlight` — `byGroup` is already converted,
 * zero-filtered and amount-desc sorted server-side (spec-WI-060 §2/§3), so
 * this consumes it verbatim with no re-sort/re-aggregation beyond the
 * `foldGroupSpend` >8 fold applied first.
 */
export function groupSpendBars(byGroup: GroupSpendEntry[], areaHeight: number): GroupSpendBar[] {
  const folded = foldGroupSpend(byGroup);
  const max = folded.reduce((acc, g) => Math.max(acc, g.amount), 0);
  return folded.map((g, index) => ({
    ...g,
    height: max > 0 && g.amount > 0 ? Math.max(4, Math.round((g.amount / max) * areaHeight)) : 2,
    isHighlight: index === 0,
  }));
}
