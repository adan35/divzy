// WI-068 S2 (Web money moments) — spec §6: the Divzy Pulse insight line.
// A pure, deterministic rule table over the existing `GET /balance` +
// `GET /analytics/summary` DTOs — no new endpoint, no client-side currency
// conversion (`formatMoney` only ever renders whatever `converted.currency`
// the server already computed, per WI-001).
import { formatMoney, type AnalyticsSummaryDto, type OverallBalanceDto } from '@divzy/shared';

export interface PulseInsightSpend {
  text: string;
  /** 'pos' when spend fell (dataviz delta convention: down = green); 'neutral' when it rose — never red. */
  tone: 'pos' | 'neutral';
}

export interface PulseInsight {
  /** Rule 1 (settled) or rule 2 (total sign) sentence. */
  base: string;
  /** Rule 3 — spend-trend clause, present only when a meaningful delta exists. */
  spend: PulseInsightSpend | null;
  /** Rule 4 — unresolved-currencies clause, present only when unresolved.length > 0. */
  unresolved: string | null;
}

type PulseBalanceInput = Pick<OverallBalanceDto, 'totals' | 'youOwe' | 'youAreOwed' | 'converted'>;

function spendClause(byMonth: AnalyticsSummaryDto['byMonth']): PulseInsightSpend | null {
  if (byMonth.length < 2) return null;
  const previous = byMonth[byMonth.length - 2]!.amount;
  const current = byMonth[byMonth.length - 1]!.amount;
  if (previous <= 0 || current === previous) return null;
  const pct = Math.round((Math.abs(current - previous) / previous) * 100);
  // Sub-half-percent deltas round to 0 — "Spend ↓0%" is not a meaningful
  // clause. Suppressed on BOTH platforms (defect-WI-068-1 byte-parity;
  // mobile `pulseInsight.ts` applies the identical magnitude-based rounding
  // and 0% suppression).
  if (pct === 0) return null;
  return current < previous
    ? { text: `Spend ↓${pct}% vs last month.`, tone: 'pos' }
    : { text: `Spend ↑${pct}% vs last month.`, tone: 'neutral' };
}

/**
 * Deterministic priority-ordered rules (spec §6):
 *  1. settled — native `totals`/`youOwe`/`youAreOwed` all empty (the WI-001
 *     guard). NEVER `converted.total === 0`, which an unresolved-only balance
 *     (or a coincidental cross-currency cancellation) can also reach.
 *  2. `total > 0` -> "You're owed {money} overall."; `total < 0` -> "You owe
 *     {money} overall." The spec's table doesn't spell out `total === 0`
 *     while NOT settled (only reachable via the unresolved-only state, or —
 *     rarer — currencies that happen to cancel post-conversion); this is a
 *     documented interpretation, not a literal spec quote (see build
 *     summary): a neutral zero sentence, distinguishing the two so the
 *     unresolved case still points at "below" via rule 4's clause.
 *  3. append a spend-trend clause whenever `byMonth` has >= 2 buckets and the
 *     previous month is a positive baseline — evaluated independently of
 *     which base sentence fired (a settled ledger still gets its trend, per
 *     story AC-6e: "the sparkline still renders ... spend trend exists even
 *     when settled").
 *  4. append the unresolved-currencies clause whenever any exist.
 *
 * defect-WI-068-1 (cycle 1): this rule table is the CANONICAL cross-platform
 * copy — mobile's `apps/mobile/src/lib/pulseInsight.ts` was converged onto
 * it (append-past-settled composition, the two `total === 0`-not-settled
 * base sentences, magnitude-based pct rounding with 0% suppression). Any
 * copy change here must be mirrored there byte-for-byte; both test files
 * carry an identical parity fixture table pinning it.
 */
export function pulseInsight(
  balance: PulseBalanceInput,
  byMonth: AnalyticsSummaryDto['byMonth'],
): PulseInsight {
  const { totals, youOwe, youAreOwed, converted } = balance;
  const settled = totals.length === 0 && youOwe.length === 0 && youAreOwed.length === 0;

  const base = settled
    ? 'All settled. Nothing owed in either direction.'
    : converted.total > 0
      ? `You're owed ${formatMoney(converted.total, converted.currency)} overall.`
      : converted.total < 0
        ? `You owe ${formatMoney(-converted.total, converted.currency)} overall.`
        : converted.unresolved.length > 0
          ? "Some balances aren't converted yet."
          : 'Your balance nets to zero overall.';

  return {
    base,
    spend: spendClause(byMonth),
    unresolved:
      converted.unresolved.length > 0
        ? `${converted.unresolved.length} ${converted.unresolved.length === 1 ? 'currency' : 'currencies'} awaiting a rate.`
        : null,
  };
}
