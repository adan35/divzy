/**
 * WI-039 — largest-remainder (Hamilton method) percent-of-total labels for
 * ExpenseSplitChart segments. Percentages are display-only derived values
 * (`amount / total`) and never feed back into any rendered money value —
 * money always stays `split.amount` via `formatMoney` (spec-WI-039 §
 * Percent-of-total computation).
 */

export interface SplitAmount {
  amount: number;
}

/**
 * Computes one integer percent per entry, in the same order as `splits`,
 * guaranteed to sum to exactly 100 (no drift, no sliver gaps/overflow when
 * reused as segment bar widths).
 *
 * Guard (spec step 1): returns `null` when `splits.length === 0` or the sum
 * of amounts is `<= 0` — the AC-guaranteed case has `S === totalAmount > 0`,
 * but this keeps the helper defensive for any legacy/malformed row. Callers
 * should omit percent labels entirely when this returns `null`.
 *
 * Algorithm (spec steps 2-5):
 * 1. raw share `r_i = amount_i * 100 / S`.
 * 2. `base_i = floor(r_i)`; remainder `rem_i = r_i - base_i`.
 * 3. distribute the leftover `L = 100 - sum(base_i)` integer points, one
 *    each, to the `L` entries with the largest `rem_i`; ties broken by
 *    larger `amount` first, then original array order (stable,
 *    deterministic).
 */
export function computeSplitPercents(splits: readonly SplitAmount[]): number[] | null {
  const total = splits.reduce((sum, s) => sum + s.amount, 0);
  if (splits.length === 0 || total <= 0) return null;

  const shares = splits.map((s, index) => {
    const raw = (s.amount * 100) / total;
    const base = Math.floor(raw);
    return { index, amount: s.amount, base, remainder: raw - base };
  });

  const leftover = 100 - shares.reduce((sum, s) => sum + s.base, 0);

  const byPriority = [...shares].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    if (b.amount !== a.amount) return b.amount - a.amount;
    return a.index - b.index;
  });

  const bumped = new Set(byPriority.slice(0, leftover).map((s) => s.index));

  const percents = new Array<number>(splits.length);
  for (const s of shares) {
    percents[s.index] = s.base + (bumped.has(s.index) ? 1 : 0);
  }
  return percents;
}
