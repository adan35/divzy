'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { CurrencyAmount, FriendBalanceBucket, FriendDto } from '@divzy/shared';
import { formatMoney } from '@divzy/shared';
import { collapsedBalanceEntries } from '@/lib/balance-display';
import { cn } from '@/lib/utils';
import { BalanceSentence } from './balance-sentence';

// spec-WI-079 D10: 5-bucket overflow threshold — >5 buckets renders the first
// 4 (already magnitude-sorted by the API) plus a "+N more groups" toggle.
const BUCKET_OVERFLOW_THRESHOLD = 5;
const BUCKET_OVERFLOW_VISIBLE = 4;

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function TreeConnector({
  isLast,
  className,
}: {
  isLast: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-testid="tree-connector"
      data-connector={isLast ? 'terminal' : 'mid'}
      className={cn(
        'relative inline-block shrink-0 border-hairline',
        'w-5',
        isLast
          ? 'self-stretch border-l border-b rounded-bl-[4px]'
          : 'self-stretch border-l border-b',
        className,
      )}
    />
  );
}

function defaultCompositionHint(bucket: FriendBalanceBucket): string | null {
  const expenseCount = bucket.expenseCount ?? 0;
  const settlementCount = bucket.settlementCount ?? 0;
  if (expenseCount === 0 && settlementCount === 0) return null;

  const parts: string[] = [];
  if (expenseCount > 0) {
    parts.push(`${expenseCount} expense${expenseCount === 1 ? '' : 's'}`);
  }
  if (settlementCount > 0) {
    parts.push(`${settlementCount} settlement${settlementCount === 1 ? '' : 's'}`);
  }

  // Order by descending count; on ties, expenses first (they are already first
  // in the parts array). Reverse only when settlements outnumber expenses.
  if (parts.length === 2 && settlementCount > expenseCount) {
    parts.reverse();
  }
  return parts.join(' · ');
}

export interface FriendBalanceBreakdownProps {
  friend: FriendDto;
  /** Defaults to "Direct (outside groups)". */
  directBucketLabel?: string;
  /** Defaults to group → /groups/:id, direct → /friends/:friendId. */
  buildBucketHref?: (bucket: FriendBalanceBucket, friend: FriendDto) => string;
  /** Optional override for the "N expenses · M settlements" hint. Defaults to D10. */
  renderCompositionHint?: (bucket: FriendBalanceBucket) => React.ReactNode;
  /** Optional wrapper class for density adjustments (defaults to existing panel classes). */
  className?: string;
  /**
   * WI-084: called when the user clicks a displayed bucket line. The payload
   * carries the bucket, the exact displayed line (amount/currency), and the
   * group scope (omitted for direct buckets).
   */
  onSettleUp?: (payload: {
    friend: FriendDto;
    bucket: FriendBalanceBucket;
    line: CurrencyAmount;
    groupId?: string;
  }) => void;
  /**
   * WI-084: the direct bucket duplicates friend-detail navigation on the
   * Friends page, so it can be suppressed there. Dashboard keeps the link.
   */
  showDirectBucketLink?: boolean;
}

function settleAriaLabel(
  friend: FriendDto,
  bucket: FriendBalanceBucket,
  line: CurrencyAmount,
  directBucketLabel: string,
): string {
  const name = firstName(friend.user.name);
  const scope = bucket.group ? `in ${bucket.group.name}` : `(outside groups)`;
  const sentence =
    line.amount > 0
      ? `${name} owes you ${formatMoney(line.amount, line.currency)}`
      : `You owe ${name} ${formatMoney(-line.amount, line.currency)}`;
  return `Settle up with ${name} ${scope} — ${sentence}`;
}

/**
 * One bucket ledger line (spec-WI-080/WI-084): tree-line prefix, group emoji+name
 * or the direct-bucket label on the left, an optional composition count hint, and
 * the collapsed converted+leftover amounts on the right. The displayed amount lines
 * are real `<button>` settle-up triggers; a small secondary `<Link>` preserves the
 * previous navigation affordance. Line clicks stop propagation so they never
 * expand/collapse the row or fire the row's primary action.
 */
function BucketLine({
  bucket,
  friend,
  isLast,
  directBucketLabel,
  buildBucketHref,
  renderCompositionHint,
  onSettleUp,
  showDirectBucketLink,
}: {
  bucket: FriendBalanceBucket;
  friend: FriendDto;
  isLast: boolean;
  directBucketLabel: string;
  buildBucketHref: (bucket: FriendBalanceBucket, friend: FriendDto) => string;
  renderCompositionHint: (bucket: FriendBalanceBucket) => React.ReactNode;
  onSettleUp?: FriendBalanceBreakdownProps['onSettleUp'];
  showDirectBucketLink: boolean;
}) {
  const entries = collapsedBalanceEntries(bucket.balancesConverted, bucket.balances);
  const visible = entries.slice(0, 2);
  const more = entries.length - visible.length;
  const label = bucket.group
    ? `${bucket.group.emoji} ${bucket.group.name}`
    : directBucketLabel;
  const hint = renderCompositionHint(bucket);
  const href = buildBucketHref(bucket, friend);
  const navAriaLabel = bucket.group
    ? `${bucket.group.name}${hint ? `, ${hint}` : ''}, go to group`
    : `${directBucketLabel}, go to friend details`;
  const showNavLink = bucket.group ? true : showDirectBucketLink;

  return (
    <div className="group flex flex-col">
      {visible.map((line, index) => {
        const isFirst = index === 0;
        return (
          <div key={`${bucket.group?.id ?? 'direct'}-${line.currency}-${index}`} className="flex items-stretch">
            <button
              type="button"
              aria-label={settleAriaLabel(friend, bucket, line, directBucketLabel)}
              onClick={(e) => {
                e.stopPropagation();
                onSettleUp?.({
                  friend,
                  bucket,
                  line,
                  groupId: bucket.group?.id,
                });
              }}
              className="flex min-w-0 flex-1 cursor-pointer items-stretch gap-3 py-2 text-left transition-colors hover:bg-surface-2 active:scale-[0.995]"
            >
              <div className="flex min-w-0 flex-1 items-stretch gap-1.5">
                {isFirst ? (
                  <TreeConnector isLast={isLast} />
                ) : (
                  <span aria-hidden="true" className="w-5 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  {isFirst && (
                    <p
                      className={cn(
                        'truncate text-[13px]',
                        bucket.group ? 'text-ink-2' : 'text-ink-3',
                      )}
                    >
                      {label}
                    </p>
                  )}
                  {isFirst && hint && <p className="text-[11px] text-ink-3">{hint}</p>}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5 tabular-nums">
                <BalanceSentence
                  name={firstName(friend.user.name)}
                  amount={line.amount}
                  currency={line.currency}
                  className="text-[13px]"
                />
                {isFirst && bucket.usedFallbackRates && (
                  <p className="text-[11px] text-warn">est. rate</p>
                )}
              </div>
            </button>
            {isFirst && showNavLink && (
              <Link
                href={href}
                aria-label={navAriaLabel}
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 flex items-center rounded-r-xl px-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
          </div>
        );
      })}
      {more > 0 && (
        <div className="flex items-stretch gap-1.5 py-2 text-left text-[13px] text-ink-3">
          <TreeConnector isLast />
          <span>+{more} more</span>
        </div>
      )}
    </div>
  );
}

/**
 * The expandable per-group breakdown panel shared by the web friends page
 * (spec-WI-079 §6.1) and the dashboard friends-preview (§6.2) — one
 * implementation so the two surfaces cannot diverge (story AC: no divergent
 * simplified view). Visual language mirrors balances-view.tsx's "Exact debts
 * as incurred": text-[13px] lines, divide-hairline separators inside a
 * hairline-top-bordered panel under the row.
 *
 * Renders only what the DTO carries — settled (zero-net) buckets are dropped
 * API-side, so no zero line can render here.
 */
export function FriendBalanceBreakdown({
  friend,
  directBucketLabel = 'Direct (outside groups)',
  buildBucketHref = (bucket, f) =>
    bucket.group ? `/groups/${bucket.group.id}` : `/friends/${f.user.id}`,
  renderCompositionHint = defaultCompositionHint,
  className,
  onSettleUp,
  showDirectBucketLink = true,
}: FriendBalanceBreakdownProps) {
  const [showAll, setShowAll] = useState(false);
  const buckets = friend.balancesByGroup;
  const collapsedOverflow = buckets.length > BUCKET_OVERFLOW_THRESHOLD && !showAll;
  const visible = collapsedOverflow ? buckets.slice(0, BUCKET_OVERFLOW_VISIBLE) : buckets;
  const hidden = buckets.length - visible.length;

  return (
    <div
      className={cn(
        'divide-y divide-hairline border-t border-hairline px-4 py-2',
        className,
      )}
    >
      {visible.map((bucket, index) => (
        <BucketLine
          key={bucket.group?.id ?? 'direct'}
          bucket={bucket}
          friend={friend}
          isLast={hidden === 0 && index === visible.length - 1}
          directBucketLabel={directBucketLabel}
          buildBucketHref={buildBucketHref}
          renderCompositionHint={renderCompositionHint}
          onSettleUp={onSettleUp}
          showDirectBucketLink={showDirectBucketLink}
        />
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowAll(true);
          }}
          className="flex w-full items-stretch gap-1.5 py-2 text-left text-[13px] font-medium text-ink-3 transition-colors hover:text-ink"
        >
          <TreeConnector isLast />
          <span>+{hidden} more groups</span>
        </button>
      )}
    </div>
  );
}
