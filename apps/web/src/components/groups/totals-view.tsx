'use client';

import { useEffect, useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { formatMoney, type PublicUserDto } from '@divzy/shared';
import { errorMessage, useExpensesInfinite, useGroup } from '@/lib/hooks';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { MoneyText } from '@/components/ui/money-text';
import { Skeleton, SkeletonList } from '@/components/ui/skeleton';

export interface TotalsViewProps {
  groupId: string;
}

interface MemberRow {
  user: PublicUserDto;
  /** currency -> minor units paid. */
  paid: ReadonlyMap<string, number>;
}

/**
 * Group totals tab: per-currency spend tiles + who-paid-what per member.
 * Aggregates every (non-deleted) expense — pages are auto-fetched until done.
 */
export function TotalsView({ groupId }: TotalsViewProps) {
  const group = useGroup(groupId);
  const expensesQuery = useExpensesInfinite({ groupId });
  const { hasNextPage, isFetchingNextPage, fetchNextPage, isError } = expensesQuery;

  // Totals need the complete ledger — drain the cursor pagination.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isError, fetchNextPage]);

  const expenses = useMemo(
    () => expensesQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [expensesQuery.data],
  );

  const { totals, memberRows } = useMemo(() => {
    const totalsMap = new Map<string, { amount: number; count: number }>();
    const paidMap = new Map<string, Map<string, number>>();
    const users = new Map<string, PublicUserDto>();

    for (const member of group.data?.members ?? []) {
      users.set(member.user.id, member.user);
    }
    for (const expense of expenses) {
      const bucket = totalsMap.get(expense.currency) ?? { amount: 0, count: 0 };
      bucket.amount += expense.amount;
      bucket.count += 1;
      totalsMap.set(expense.currency, bucket);
      for (const payer of expense.payers) {
        if (!users.has(payer.user.id)) users.set(payer.user.id, payer.user);
        let perCurrency = paidMap.get(payer.user.id);
        if (!perCurrency) {
          perCurrency = new Map<string, number>();
          paidMap.set(payer.user.id, perCurrency);
        }
        perCurrency.set(expense.currency, (perCurrency.get(expense.currency) ?? 0) + payer.amount);
      }
    }

    const groupCurrency = group.data?.currency ?? '';
    const rows: MemberRow[] = [...users.values()].map((user) => ({
      user,
      paid: paidMap.get(user.id) ?? new Map<string, number>(),
    }));
    rows.sort((a, b) => {
      const paidA = a.paid.get(groupCurrency) ?? 0;
      const paidB = b.paid.get(groupCurrency) ?? 0;
      return paidB - paidA || a.user.name.localeCompare(b.user.name);
    });

    return { totals: totalsMap, memberRows: rows };
  }, [expenses, group.data]);

  const stillLoading =
    expensesQuery.isLoading || hasNextPage === true || isFetchingNextPage || group.isLoading;

  if (expensesQuery.isError) {
    return (
      <Card className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-ink-2">{errorMessage(expensesQuery.error)}</p>
        <Button variant="secondary" size="sm" onClick={() => void expensesQuery.refetch()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
      </Card>
    );
  }

  if (stillLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 2 }, (_, i) => (
            <Card key={i} className="space-y-3 p-5">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-8 w-3/5" />
              <Skeleton className="h-3 w-1/4" />
            </Card>
          ))}
        </div>
        <SkeletonList rows={3} />
      </div>
    );
  }

  if (expenses.length === 0) {
    return (
      <EmptyState
        emoji="🧾"
        title="No expenses yet"
        hint="Totals appear once this group has its first expense."
      />
    );
  }

  const totalEntries = [...totals.entries()].sort(([a], [b]) => a.localeCompare(b));
  const groupCurrency = group.data?.currency ?? totalEntries[0]?.[0] ?? 'USD';

  return (
    <div className="space-y-6">
      {/* Per-currency spend tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {totalEntries.map(([currency, { amount, count }]) => (
          <Card key={currency} className="p-5">
            <p className="text-[13px] text-ink-2">Total spent · {currency}</p>
            <p className="mt-1 text-[28px] font-semibold leading-tight tracking-tight text-ink tabular-nums">
              {formatMoney(amount, currency)}
            </p>
            <p className="mt-1 text-[13px] text-ink-3">
              {count} expense{count === 1 ? '' : 's'}
            </p>
          </Card>
        ))}
      </div>

      {/* Who paid what */}
      <Card>
        <CardHeader>
          <CardTitle>Who paid what</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-hairline p-0 pt-3">
          {memberRows.map(({ user, paid }) => {
            const entries = [...paid.entries()].sort(([a], [b]) => a.localeCompare(b));
            return (
              <div key={user.id} className="flex items-center gap-3 px-5 py-3">
                <Avatar user={user} size="sm" />
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{user.name}</p>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  {entries.length === 0 ? (
                    <MoneyText
                      amount={0}
                      currency={groupCurrency}
                      className="text-sm text-ink-3"
                    />
                  ) : (
                    entries.map(([currency, amount]) => (
                      <MoneyText
                        key={currency}
                        amount={amount}
                        currency={currency}
                        className="text-sm font-medium"
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
