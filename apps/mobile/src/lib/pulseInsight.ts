import { formatMoney } from '@divzy/shared';

/**
 * spec-WI-068 §6 — the Divzy Pulse insight line, mobile half. Deliberately a
 * pure, dependency-free module (no `@/theme` import) so it stays importable
 * under vitest's plain-Node environment, mirroring the `./tokens` pattern
 * (see theme/tokens.ts's doc comment) — `PulseHero.tsx` is the only
 * RN-coupled consumer.
 *
 * Cross-platform copy parity with the web `pulse-insight.ts` (same spec §6
 * rule table): spec-named strings are transcribed verbatim; the two
 * `total === 0`-not-settled base sentences (which the spec table doesn't
 * name) are converged byte-for-byte with web per defect-WI-068-1 (cycle 1).
 */

export interface PulseInsightConverted {
  /** Signed, minor units, in `currency`. */
  total: number;
  currency: string;
  /** `GET /balance`'s `converted.unresolved` — currencies with no resolvable rate. */
  unresolved: readonly { currency: string; amount: number }[];
}

export interface PulseInsightMonth {
  month: string;
  /** Minor units, converted (matches `AnalyticsSummaryDto.byMonth[].amount`). */
  amount: number;
}

/**
 * `settled` must be derived by the caller from the NATIVE
 * `totals`/`youOwe`/`youAreOwed` arrays (all empty), never from
 * `converted.total === 0` — the WI-001 guard: a currency excluded from
 * `converted.*` because it's unresolved must never read as settled (spec §6
 * "Unresolved-only", story AC-6e).
 *
 * Priority order (spec §6). Rules (1)/(2) pick ONE base sentence; rules
 * (3)/(4) are APPEND clauses — per the spec's literal "append" phrasing they
 * compose on top of WHICHEVER base fired, including the settled sentence
 * (spec §6's settled state: "Sparkline still renders (spend trend exists
 * even when settled)"). defect-WI-068-1 (cycle 1) converged this file onto
 * the canonical web rule table (`apps/web/src/components/dashboard/
 * pulse-insight.ts`) — identical inputs MUST produce byte-identical output;
 * both test files carry an identical parity fixture table pinning it.
 *   1. settled -> "All settled. Nothing owed in either direction."
 *   2. total > 0 / total < 0 -> the owed/owe sentence (money via
 *      `formatMoney`, absolute value — the direction is carried by the
 *      wording, not a minus sign, same convention as the pre-Pulse hero).
 *      total === 0 while NOT settled (the spec table names no copy):
 *      unresolved currencies present -> "Some balances aren't converted
 *      yet." (points at rule 4's clause; never reads settled-adjacent while
 *      balances are unconvertible); none -> "Your balance nets to zero
 *      overall." (coincidental cross-currency cancellation).
 *   3. append the spend-delta clause only when byMonth has >= 2 buckets AND
 *      the previous bucket is > 0 (a meaningful percentage exists) AND the
 *      magnitude-rounded percentage isn't exactly 0 ("Spend ↓0%" is not a
 *      clause). Decrease -> "Spend ↓{n}% vs last month." (pos/green);
 *      increase -> "Spend ↑{n}% vs last month." (neutral ink-2) — never red
 *      (STYLE.md's spend-delta convention). The percentage rounds the
 *      MAGNITUDE (`Math.round(Math.abs(delta)/previous*100)`) so a
 *      half-percent drop reads ↓1% exactly like a half-percent rise reads
 *      ↑1% (signed `Math.round(-0.5)` would asymmetrically swallow it).
 *   4. append "{n} currency(-ies) awaiting a rate." when unresolved is
 *      non-empty.
 */
export function pulseInsight(
  settled: boolean,
  converted: PulseInsightConverted,
  byMonth: readonly PulseInsightMonth[],
): string {
  const parts: string[] = [];

  if (settled) {
    parts.push('All settled. Nothing owed in either direction.');
  } else if (converted.total > 0) {
    parts.push(`You're owed ${formatMoney(converted.total, converted.currency)} overall.`);
  } else if (converted.total < 0) {
    parts.push(`You owe ${formatMoney(Math.abs(converted.total), converted.currency)} overall.`);
  } else if (converted.unresolved.length > 0) {
    parts.push("Some balances aren't converted yet.");
  } else {
    parts.push('Your balance nets to zero overall.');
  }

  if (byMonth.length >= 2) {
    const previous = byMonth[byMonth.length - 2]!.amount;
    const current = byMonth[byMonth.length - 1]!.amount;
    if (previous > 0 && current !== previous) {
      const pct = Math.round((Math.abs(current - previous) / previous) * 100);
      if (pct !== 0) {
        parts.push(
          current < previous
            ? `Spend ↓${pct}% vs last month.`
            : `Spend ↑${pct}% vs last month.`,
        );
      }
    }
  }

  if (converted.unresolved.length > 0) {
    const n = converted.unresolved.length;
    parts.push(`${n} ${n === 1 ? 'currency' : 'currencies'} awaiting a rate.`);
  }

  return parts.join(' ');
}
