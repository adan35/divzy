'use client';

import { formatMoney, type GroupSummaryDto } from '@divzy/shared';
import { collapsedBalanceEntries } from '@/lib/balance-display';
import { cn } from '@/lib/utils';
import { FallbackRatesNotice } from '@/components/ui/fallback-rates-notice';

/**
 * Your net position, phrased per STYLE.md — color always paired with wording.
 * Per spec-WI-001: `yourBalanceConverted` (if any) renders as the one
 * converted line, then any `yourBalances` leftovers (currencies with no
 * resolvable rate) render as additional native-currency lines exactly as
 * they always have — "settled up" only when both are empty.
 */
export function BalanceSentences({
  yourBalanceConverted,
  yourBalances,
  usedFallbackRates,
}: {
  yourBalanceConverted: GroupSummaryDto['yourBalanceConverted'];
  yourBalances: GroupSummaryDto['yourBalances'];
  usedFallbackRates: boolean;
}) {
  const entries = collapsedBalanceEntries(yourBalanceConverted, yourBalances);
  if (entries.length === 0) {
    return <p className="text-sm text-ink-3">You&rsquo;re all settled up</p>;
  }
  return (
    <div className="space-y-0.5">
      {entries.map((b) => (
        <p
          key={b.currency}
          className={cn(
            'text-sm font-medium tabular-nums',
            b.amount > 0 ? 'text-pos' : 'text-neg',
          )}
        >
          {b.amount > 0
            ? `You are owed ${formatMoney(b.amount, b.currency)}`
            : `You owe ${formatMoney(-b.amount, b.currency)}`}
        </p>
      ))}
      {usedFallbackRates && <FallbackRatesNotice className="text-[11px]" />}
    </div>
  );
}
