'use client';

import { useState } from 'react';
import { ChevronRight, HandCoins, MoveRight, RefreshCw } from 'lucide-react';
import { formatMoney, type CurrencyAmount, type PublicUserDto } from '@divzy/shared';
import { errorMessage, useGroup, useGroupBalances, useUpdateGroup } from '@/lib/hooks';
import { useAuth } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FallbackRatesNotice } from '@/components/ui/fallback-rates-notice';
import { MoneyText } from '@/components/ui/money-text';
import { SkeletonList } from '@/components/ui/skeleton';
import { ManualRatePrompts } from '@/components/settle/manual-rate-prompt';
import { SettleUpDialog, type SettleUpPrefill } from '@/components/settle/settle-dialog';
import { GroupMemberSettlements } from './group-member-settlements';

export interface BalancesViewProps {
  groupId: string;
}

/** "gets back $12.50" / "owes $3.00" — always wording + color, never a bare sign. */
function netPhrase(amount: number, currency: string, isMe: boolean): string {
  const money = formatMoney(Math.abs(amount), currency);
  if (amount > 0) return isMe ? `you get back ${money}` : `gets back ${money}`;
  return isMe ? `you owe ${money}` : `owes ${money}`;
}

/** First occurrence per currency — used to feed the shared manual-rate prompt one entry per pair. */
function dedupeByCurrency(entries: CurrencyAmount[]): CurrencyAmount[] {
  const seen = new Map<string, CurrencyAmount>();
  for (const entry of entries) {
    if (!seen.has(entry.currency)) seen.set(entry.currency, entry);
  }
  return [...seen.values()];
}

/** "1 payment" / "3 payments" — never a bare, possibly-plural-wrong count. */
function paymentCount(n: number): string {
  return `${n} payment${n === 1 ? '' : 's'}`;
}

interface ToggleProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** WI-013 — small controlled switch, styled to match GroupFormDialog's toggle. */
function Toggle({ id, checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-10 shrink-0 rounded-full transition-colors',
        checked ? 'bg-brand' : 'bg-surface-2 ring-1 ring-inset ring-hairline',
        disabled && 'cursor-not-allowed opacity-55',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
          checked && 'translate-x-4',
        )}
      />
    </button>
  );
}

/**
 * Group balances tab: per-member nets, suggested settlements with one-tap
 * "Record payment", and an expandable exact (pairwise) debt list.
 */
export function BalancesView({ groupId }: BalancesViewProps) {
  const { user: me } = useAuth();
  const balances = useGroupBalances(groupId);
  const group = useGroup(groupId);
  const updateGroup = useUpdateGroup();
  const [showExact, setShowExact] = useState(false);
  const [settle, setSettle] = useState<{ prefill?: SettleUpPrefill } | null>(null);
  // WI-013: optimistic local override of the persisted Group.simplifyDebts —
  // null means "use the persisted value"; set on toggle, cleared on
  // success/error (reverting to the — possibly re-fetched — persisted value).
  const [simplifyOverride, setSimplifyOverride] = useState<boolean | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  if (balances.isLoading) {
    return <SkeletonList rows={4} />;
  }

  if (balances.isError) {
    return (
      <Card className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-ink-2">{errorMessage(balances.error)}</p>
        <Button variant="secondary" size="sm" onClick={() => void balances.refetch()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
      </Card>
    );
  }

  const data = balances.data;
  if (!data) return null;

  // WI-013: source of truth is the persisted Group.simplifyDebts, with an
  // optimistic local override while a toggle PATCH is in flight/pending
  // settling (cleared on both success and error — the error path also
  // reverts by definition, since it restores the persisted value).
  const persistedSimplify = group.data?.simplifyDebts ?? true;
  const simplifyDebts = simplifyOverride ?? persistedSimplify;

  const handleToggleSimplify = (next: boolean) => {
    setToggleError(null);
    setSimplifyOverride(next);
    updateGroup.mutate(
      { groupId, input: { simplifyDebts: next } },
      {
        onSuccess: () => setSimplifyOverride(null),
        onError: (error) => {
          setSimplifyOverride(null);
          setToggleError(errorMessage(error));
        },
      },
    );
  };

  // WI-013: before/after payment-count comparison — always both counts
  // (never implies a false saving when already-minimal), currency-agnostic
  // (pairwise/suggestions already flatten across currencies), omitted only
  // when the group is fully settled (both 0).
  const beforeCount = data.pairwise.length;
  const afterCount = data.suggestions.length;
  const showComparison = beforeCount > 0 || afterCount > 0;

  // ON -> the simplified suggestions (today's behavior); OFF -> the exact,
  // unsimplified pairwise debts, each independently actionable (WI-013).
  const actionable = simplifyDebts ? data.suggestions : data.pairwise;

  // Show the requesting user first; everyone else in API order.
  const members = [...data.members].sort((a, b) => {
    if (me) {
      if (a.user.id === me.id) return -1;
      if (b.user.id === me.id) return 1;
    }
    return 0;
  });

  const displayName = (user: PublicUserDto): string =>
    me && user.id === me.id ? 'You' : user.name;

  // WI-002: every member's unresolved native currency, deduped, feeds one
  // shared manual-rate prompt for this whole balances view.
  const unresolved = dedupeByCurrency(
    data.members.flatMap((m) => m.convertedNet?.unresolved ?? []),
  );

  return (
    <div className="space-y-6">
      {data.usedFallbackRates && <FallbackRatesNotice />}

      {me && (
        <GroupMemberSettlements
          groupId={groupId}
          data={data}
          meId={me.id}
          onSettleUp={(prefill) => setSettle({ prefill })}
        />
      )}

      {/* Per-member nets — collapsed to one converted figure (WI-001) */}
      <Card className="divide-y divide-hairline">
        {members.map(({ user, balances: nets, convertedNet }) => {
          const isMe = me?.id === user.id;
          const settled = nets.length === 0;
          return (
            <div key={user.id} className="flex items-center gap-3 px-4 py-3.5">
              <Avatar user={user} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">
                  {user.name}
                  {isMe && <span className="ml-1 text-ink-3">(you)</span>}
                </p>
                <p className="truncate text-[13px] text-ink-3">
                  {settled
                    ? 'settled up'
                    : convertedNet
                      ? netPhrase(convertedNet.amount, data.viewerCurrency, isMe)
                      : nets.map((n) => netPhrase(n.amount, n.currency, isMe)).join(' · ')}
                </p>
                {convertedNet && convertedNet.unresolved.length > 0 && (
                  <p className="truncate text-[12px] text-warn">
                    {convertedNet.unresolved
                      .map((u) => `${formatMoney(Math.abs(u.amount), u.currency)} unconverted`)
                      .join(' · ')}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                {settled ? (
                  <span className="text-sm text-ink-3">—</span>
                ) : convertedNet ? (
                  <MoneyText
                    amount={convertedNet.amount}
                    currency={data.viewerCurrency}
                    mode="signed-color"
                    className="text-sm"
                  />
                ) : (
                  nets.map((n) => (
                    <MoneyText
                      key={n.currency}
                      amount={n.amount}
                      currency={n.currency}
                      mode="signed-color"
                      className="text-sm"
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </Card>

      {/* Suggested settlements (ON) / exact debts as incurred (OFF) — WI-013 */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">
              {simplifyDebts ? 'Suggested settlements' : 'Debts as incurred'}
            </h3>
            {showComparison && (
              <span
                data-testid="payment-count-comparison"
                className="text-[12px] text-ink-3"
              >
                {paymentCount(beforeCount)} → {paymentCount(afterCount)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <label
              htmlFor="simplify-debts-toggle"
              className="flex items-center gap-2 text-[13px] text-ink-2"
            >
              Simplify debts
              <Toggle
                id="simplify-debts-toggle"
                checked={simplifyDebts}
                onChange={handleToggleSimplify}
                disabled={updateGroup.isPending}
              />
            </label>
            <Button variant="ghost" size="sm" onClick={() => setSettle({})}>
              <HandCoins className="h-4 w-4" aria-hidden="true" />
              Record a payment
            </Button>
          </div>
        </div>

        {toggleError && (
          <p className="text-[13px] text-danger" role="alert">
            {toggleError}
          </p>
        )}

        {actionable.length === 0 ? (
          <Card className="p-6 text-center">
            <div className="text-2xl" aria-hidden="true">
              ✅
            </div>
            <p className="mt-1.5 text-sm font-medium text-ink">All settled up</p>
            <p className="text-[13px] text-ink-3">No one needs to pay anyone in this group.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {actionable.map((row) => {
              // WI-004: disable (not hide, per ADR-004) for rows the current
              // user isn't a party to — the server already 403s a direct API
              // bypass; this only stops the dead-end click. Reused as-is for
              // the unsimplified pairwise list (WI-013).
              const canRecord = me?.id === row.fromUserId || me?.id === row.toUserId;
              return (
                <Card
                  key={`${row.currency}-${row.fromUserId}-${row.toUserId}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar user={row.from} size="sm" />
                    <span className="truncate text-sm font-medium text-ink">
                      {displayName(row.from)}
                    </span>
                  </span>
                  <MoveRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar user={row.to} size="sm" />
                    <span className="truncate text-sm font-medium text-ink">
                      {displayName(row.to)}
                    </span>
                  </span>
                  <span className="ml-auto flex items-center gap-3">
                    <MoneyText
                      amount={row.amount}
                      currency={row.currency}
                      className="text-sm font-semibold"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canRecord}
                      onClick={() =>
                        setSettle({
                          prefill: {
                            fromUserId: row.fromUserId,
                            toUserId: row.toUserId,
                            amount: row.amount,
                            currency: row.currency,
                          },
                        })
                      }
                    >
                      Record payment
                    </Button>
                  </span>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Exact (pairwise) debts */}
      {data.pairwise.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            aria-expanded={showExact}
            onClick={() => setShowExact((v) => !v)}
            className="flex items-center gap-1 text-[13px] font-medium text-ink-3 transition-colors hover:text-ink"
          >
            <ChevronRight
              className={cn('h-4 w-4 transition-transform', showExact && 'rotate-90')}
              aria-hidden="true"
            />
            Exact debts as incurred ({data.pairwise.length})
          </button>
          {showExact && (
            <Card className="divide-y divide-hairline" data-testid="exact-debts">
              {data.pairwise.map((d) => (
                <div
                  key={`${d.currency}-${d.fromUserId}-${d.toUserId}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <p className="min-w-0 truncate text-[13px] text-ink-2">
                    <span className="font-medium text-ink">{displayName(d.from)}</span>
                    {' owes '}
                    <span className="font-medium text-ink">{displayName(d.to)}</span>
                  </p>
                  <span className="flex shrink-0 items-center gap-2">
                    <MoneyText
                      amount={d.amount}
                      currency={d.currency}
                      className="text-[13px] text-ink-2"
                    />
                    {/* Converted equivalent (WI-001) — omitted, not zeroed, when
                        this row's currency has no resolvable rate to viewerCurrency. */}
                    {d.convertedAmount !== undefined && (
                      <span className="flex items-center gap-1 text-[12px] text-ink-3">
                        <span aria-hidden="true">≈</span>
                        <MoneyText amount={d.convertedAmount} currency={data.viewerCurrency} />
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {settle !== null && (
        <SettleUpDialog
          open
          onOpenChange={(open) => {
            if (!open) setSettle(null);
          }}
          groupId={groupId}
          prefill={settle.prefill}
        />
      )}

      <ManualRatePrompts
        unresolved={unresolved}
        viewerCurrency={data.viewerCurrency}
        onResolved={() => void balances.refetch()}
      />
    </div>
  );
}
