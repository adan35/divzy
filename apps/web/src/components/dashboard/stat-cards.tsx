'use client';

import type { ReactNode } from 'react';
import type { CurrencyAmount } from '@divzy/shared';
import { formatMoney } from '@divzy/shared';
import { useAuth } from '@/lib/auth-store';
import { useOverallBalance } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { MoneyText } from '@/components/ui/money-text';
import { Skeleton } from '@/components/ui/skeleton';
import { orderByPrimaryCurrency } from './balance-utils';
import { SectionError } from './section-error';

function StatCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <p className="text-[13px] font-medium text-ink-2">{label}</p>
      <div className="mt-1.5">{children}</div>
    </Card>
  );
}

/** Secondary currencies rendered as small rows under the primary amount. */
function SubRows({
  entries,
  tone,
}: {
  entries: CurrencyAmount[];
  tone: 'signed' | 'neg' | 'pos';
}) {
  if (entries.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-0.5">
      {entries.map((e) =>
        tone === 'signed' ? (
          <MoneyText
            key={e.currency}
            amount={e.amount}
            currency={e.currency}
            mode="signed-color"
            className="block text-sm"
          />
        ) : (
          <span
            key={e.currency}
            className={cn(
              'block text-sm font-medium tabular-nums',
              tone === 'neg' ? 'text-neg' : 'text-pos',
            )}
          >
            {formatMoney(Math.abs(e.amount), e.currency)}
          </span>
        ),
      )}
    </div>
  );
}

const BIG = 'text-[28px] font-semibold leading-tight tabular-nums';

/**
 * Hero row: Total balance / You owe / You are owed, from the overall balance
 * endpoint. Multi-currency: the user's default currency shows big, remaining
 * currencies as small rows beneath.
 */
export function BalanceStatCards() {
  const { user } = useAuth();
  const balance = useOverallBalance();
  const primary = user?.defaultCurrency ?? 'USD';

  if (balance.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="p-5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="mt-3 h-8 w-32" />
            <Skeleton className="mt-2 h-3 w-40" />
          </Card>
        ))}
      </div>
    );
  }

  if (balance.isError) {
    return <SectionError error={balance.error} onRetry={() => void balance.refetch()} />;
  }

  const totals = orderByPrimaryCurrency(balance.data.totals, primary);
  const owes = orderByPrimaryCurrency(balance.data.youOwe, primary);
  const oweds = orderByPrimaryCurrency(balance.data.youAreOwed, primary);
  const settled = totals.length === 0 && owes.length === 0 && oweds.length === 0;

  const totalPrimary = totals[0];
  const owePrimary = owes[0];
  const owedPrimary = oweds[0];

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <StatCard label="Total balance">
        {settled ? (
          <>
            <p className={cn(BIG, 'text-ink')}>
              <span aria-hidden="true">🎉</span>
            </p>
            <p className="mt-1.5 text-sm font-medium text-ink-2">All settled up</p>
          </>
        ) : !totalPrimary ? (
          <>
            <p className={cn(BIG, 'text-ink-3')}>{formatMoney(0, primary)}</p>
            <p className="mt-1.5 text-[13px] text-ink-3">
              Your debts and credits balance out
            </p>
          </>
        ) : (
          <>
            <MoneyText
              amount={totalPrimary.amount}
              currency={totalPrimary.currency}
              mode="signed-color"
              className={cn('block', BIG)}
            />
            <SubRows entries={totals.slice(1)} tone="signed" />
            <p className="mt-1.5 text-[13px] text-ink-3">
              {totalPrimary.amount > 0
                ? 'Overall, you are owed money'
                : 'Overall, you owe money'}
            </p>
          </>
        )}
      </StatCard>

      <StatCard label="You owe">
        {!owePrimary ? (
          <>
            <p className={cn(BIG, 'text-ink-3')}>{formatMoney(0, primary)}</p>
            <p className="mt-1.5 text-[13px] text-ink-3">
              You don&rsquo;t owe anyone right now
            </p>
          </>
        ) : (
          <>
            <p className={cn(BIG, 'text-neg')}>
              {formatMoney(Math.abs(owePrimary.amount), owePrimary.currency)}
            </p>
            <SubRows entries={owes.slice(1)} tone="neg" />
          </>
        )}
      </StatCard>

      <StatCard label="You are owed">
        {!owedPrimary ? (
          <>
            <p className={cn(BIG, 'text-ink-3')}>{formatMoney(0, primary)}</p>
            <p className="mt-1.5 text-[13px] text-ink-3">
              No one owes you right now
            </p>
          </>
        ) : (
          <>
            <p className={cn(BIG, 'text-pos')}>
              {formatMoney(Math.abs(owedPrimary.amount), owedPrimary.currency)}
            </p>
            <SubRows entries={oweds.slice(1)} tone="pos" />
          </>
        )}
      </StatCard>
    </div>
  );
}
