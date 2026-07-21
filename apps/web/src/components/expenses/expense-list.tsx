'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Plus, Search } from 'lucide-react';
import {
  categoryInfo,
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
  type ExpenseDto,
} from '@divzy/shared';
import { useAuth } from '@/lib/auth-store';
import { errorMessage, useExpensesInfinite, useUsedCategories, type ExpenseFilters } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { AvatarStack } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { MoneyText } from '@/components/ui/money-text';
import { SkeletonList } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { ExpenseDetailDialog } from './expense-detail';
import { ExpenseEditorDialog } from './expense-editor';

export interface ExpenseListProps {
  /** Limit to one group's expenses. */
  groupId?: string;
  /** Limit to expenses shared with this friend (their user id). */
  friendId?: string;
  /** Empty-state hint when there are no expenses at all. */
  emptyHint?: string;
}

/** My position on one expense: paid − my share. */
function myLens(expense: ExpenseDto, meId: string | undefined) {
  if (!meId) return { involved: false, net: 0 };
  const paid = expense.payers
    .filter((p) => p.user.id === meId)
    .reduce((acc, p) => acc + p.amount, 0);
  const split = expense.splits.find((s) => s.user.id === meId);
  const involved = paid > 0 || split !== undefined;
  return { involved, net: paid - (split?.amount ?? 0) };
}

/** Who paid — the name/count half of "X paid $Y" (the amount renders separately via MoneyText). */
function payerName(expense: ExpenseDto, meId: string | undefined): string {
  if (expense.payers.length > 1) {
    return `${expense.payers.length} people`;
  }
  const payer = expense.payers[0];
  return !payer ? 'Someone' : payer.user.id === meId ? 'You' : payer.user.name;
}

interface MonthGroup {
  key: string;
  label: string;
  items: ExpenseDto[];
}

/**
 * Infinite expense list with debounced search, category filter chips and
 * month headers. Rows open the full detail dialog.
 */
export function ExpenseList({ groupId, friendId, emptyHint }: ExpenseListProps) {
  const { user: me } = useAuth();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState<ExpenseCategory | undefined>(undefined);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  // Debounce the search box (300ms) into the actual query filter.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const filters: ExpenseFilters = {
    groupId,
    friendId,
    category,
    search: debouncedSearch || undefined,
  };
  const query = useExpensesInfinite(filters);

  // WI-063 + WI-064: every mount (group, friend, and the unscoped "All
  // expenses" page) narrows the pill row to categories actually in use in
  // that context (D1/D2/D3).
  const usedCategories = useUsedCategories({ groupId, friendId }, { unscoped: true });

  const shownCategories = useMemo(() => {
    const used = new Set(usedCategories.data?.categories ?? []);
    return EXPENSE_CATEGORIES.filter((c) => used.has(c.key));
  }, [usedCategories.data]);

  // D4: if the selected category drops out of the freshly-loaded used set,
  // reset to "All" rather than leaving an invisible/stuck filter selected.
  useEffect(() => {
    if (!category || !usedCategories.data) return;
    if (!usedCategories.data.categories.includes(category)) setCategory(undefined);
  }, [category, usedCategories.data]);

  const expenses = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  const monthGroups = useMemo<MonthGroup[]>(() => {
    const groups: MonthGroup[] = [];
    for (const expense of expenses) {
      const date = parseISO(expense.date);
      const key = format(date, 'yyyy-MM');
      const last = groups[groups.length - 1];
      if (last && last.key === key) {
        last.items.push(expense);
      } else {
        groups.push({ key, label: format(date, 'MMMM yyyy'), items: [expense] });
      }
    }
    return groups;
  }, [expenses]);

  // Load-more sentinel.
  const sentinelRef = useRef<HTMLDivElement>(null);
  const fetchingRef = useRef(false);
  fetchingRef.current = query.isFetchingNextPage;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !query.hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !fetchingRef.current) {
          void query.fetchNextPage();
        }
      },
      { rootMargin: '240px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.hasNextPage, query.fetchNextPage, monthGroups.length]);

  const hasFilters = debouncedSearch.length > 0 || category !== undefined;

  return (
    <div className="space-y-4">
      {/* Search + category chips */}
      <div className="space-y-2.5">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search expenses…"
            aria-label="Search expenses"
            className="pl-9"
          />
        </div>
        <div className="scrollbar-thin flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label="Filter by category">
          <button
            type="button"
            aria-pressed={category === undefined}
            onClick={() => setCategory(undefined)}
            className={cn(
              'whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
              category === undefined
                ? 'bg-brand-soft text-brand'
                : 'bg-surface-2 text-ink-2 hover:text-ink',
            )}
          >
            All
          </button>
          {shownCategories.map((c) => {
            const active = category === c.key;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(active ? undefined : c.key)}
                className={cn(
                  'whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
                  active ? 'bg-brand-soft text-brand' : 'bg-surface-2 text-ink-2 hover:text-ink',
                )}
              >
                <span aria-hidden="true">{c.emoji}</span> {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      {query.isLoading ? (
        <SkeletonList rows={5} avatar={false} />
      ) : query.isError ? (
        <div className="space-y-3 rounded-xl2 border border-hairline bg-surface p-5 text-center">
          <p className="text-sm text-neg" role="alert">
            {errorMessage(query.error)}
          </p>
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </div>
      ) : expenses.length === 0 ? (
        hasFilters ? (
          <EmptyState
            emoji="🧾"
            title="No matching expenses"
            hint="Try a different search or category filter."
          />
        ) : (
          <EmptyState
            emoji="🧾"
            title="No expenses yet"
            hint={emptyHint ?? 'Expenses you add or share will show up here.'}
            action={
              <Button onClick={() => setEditorOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add expense
              </Button>
            }
          />
        )
      ) : (
        <div className="space-y-5">
          {monthGroups.map((month) => (
            <section key={month.key} aria-label={month.label}>
              <h3 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-ink-3">
                {month.label}
              </h3>
              <div className="divide-y divide-hairline rounded-xl2 border border-hairline bg-surface shadow-sm dark:shadow-none">
                {month.items.map((expense) => {
                  const lens = myLens(expense, me?.id);
                  const date = parseISO(expense.date);
                  return (
                    <button
                      key={expense.id}
                      type="button"
                      onClick={() => setDetailId(expense.id)}
                      className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors first:rounded-t-xl2 last:rounded-b-xl2 hover:bg-surface-2"
                    >
                      <span
                        aria-hidden="true"
                        className="flex w-10 shrink-0 flex-col items-center rounded-lg bg-surface-2 py-1"
                      >
                        <span className="text-[10px] font-medium uppercase leading-tight text-ink-3">
                          {format(date, 'MMM')}
                        </span>
                        <span className="text-sm font-semibold leading-tight tabular-nums text-ink">
                          {format(date, 'd')}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-lg"
                      >
                        {categoryInfo(expense.category).emoji}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {expense.description}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink-3">
                          <AvatarStack users={expense.payers.map((p) => p.user)} size="xs" max={3} />
                          <span className="truncate">
                            {payerName(expense, me?.id)} paid{' '}
                            <MoneyText amount={expense.amount} currency={expense.currency} />
                            {!groupId && expense.group && (
                              <> · {expense.group.emoji} {expense.group.name}</>
                            )}
                            {/* Converted equivalent (WI-014) — omitted, not zeroed, when
                                the server couldn't resolve a rate for this row. */}
                            {expense.convertedAmount !== undefined && (
                              <span className="ml-1 inline-flex items-center gap-1">
                                <span aria-hidden="true">≈</span>
                                <MoneyText amount={expense.convertedAmount} currency={expense.convertedCurrency!} />
                                {expense.isApproximateRate && (
                                  <span
                                    className="font-semibold text-warn"
                                    title="Approximate — today's rate; the rate on this expense's date isn't available"
                                    aria-label="Approximate — today's rate; the rate on this expense's date isn't available"
                                  >
                                    *
                                  </span>
                                )}
                              </span>
                            )}
                          </span>
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end">
                        {!lens.involved ? (
                          <span className="text-xs text-ink-3">not involved</span>
                        ) : lens.net === 0 ? (
                          <span className="text-xs text-ink-3">no balance</span>
                        ) : (
                          <>
                            <span className="text-[11px] leading-tight text-ink-3">
                              {lens.net > 0 ? 'you lent' : 'you borrowed'}
                            </span>
                            <MoneyText
                              amount={Math.abs(lens.net)}
                              currency={expense.currency}
                              className={cn(
                                'text-sm font-semibold leading-tight',
                                lens.net > 0 ? 'text-pos' : 'text-neg',
                              )}
                            />
                            <span className="text-[10px] leading-tight text-ink-3">at the time</span>
                          </>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}

          {/* Infinite-scroll sentinel + fallback button */}
          <div ref={sentinelRef} aria-hidden="true" />
          {query.isFetchingNextPage && (
            <div className="flex items-center justify-center gap-2 py-2 text-sm text-ink-3">
              <Spinner size="sm" />
              Loading more…
            </div>
          )}
          {!query.isFetchingNextPage && query.hasNextPage && (
            <div className="flex justify-center">
              <Button variant="ghost" size="sm" onClick={() => void query.fetchNextPage()}>
                Load more
              </Button>
            </div>
          )}
        </div>
      )}

      <ExpenseDetailDialog
        expenseId={detailId ?? ''}
        open={detailId !== null}
        onOpenChange={(o) => {
          if (!o) setDetailId(null);
        }}
      />
      <ExpenseEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        groupId={groupId}
        friendUserId={friendId}
      />
    </div>
  );
}
