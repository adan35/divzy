'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { FriendBalanceBucket, FriendDto } from '@divzy/shared';
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
}

/**
 * One bucket ledger line (spec-WI-080): tree-line prefix, group emoji+name or
 * the direct-bucket label on the left, an optional composition count hint, and
 * the collapsed converted+leftover amounts on the right. The whole line is a
 * next/link to the group (or friend detail page for the direct bucket). Line
 * clicks stop propagation so they never expand/collapse the row or fire the
 * row's primary action.
 */
function BucketLine({
  bucket,
  friend,
  isLast,
  directBucketLabel,
  buildBucketHref,
  renderCompositionHint,
}: {
  bucket: FriendBalanceBucket;
  friend: FriendDto;
  isLast: boolean;
  directBucketLabel: string;
  buildBucketHref: (bucket: FriendBalanceBucket, friend: FriendDto) => string;
  renderCompositionHint: (bucket: FriendBalanceBucket) => React.ReactNode;
}) {
  const entries = collapsedBalanceEntries(bucket.balancesConverted, bucket.balances);
  const visible = entries.slice(0, 2);
  const more = entries.length - visible.length;
  const label = bucket.group
    ? `${bucket.group.emoji} ${bucket.group.name}`
    : directBucketLabel;
  const hint = renderCompositionHint(bucket);
  const href = buildBucketHref(bucket, friend);
  const ariaLabel = bucket.group
    ? `${bucket.group.name}${hint ? `, ${hint}` : ''}, go to group`
    : `${directBucketLabel}, go to friend details`;

  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      onClick={(e) => e.stopPropagation()}
      className="flex items-start justify-between gap-3 py-2 hover:bg-surface-2"
    >
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-[13px]',
            bucket.group ? 'text-ink-2' : 'text-ink-3',
          )}
        >
          <span className="inline-block w-[1.75em] shrink-0 font-mono text-ink-3">
            {isLast ? '└─ ' : '├─ '}
          </span>
          {label}
        </p>
        {hint && (
          <p className="pl-[1.75em] text-[11px] text-ink-3">{hint}</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 tabular-nums">
        {visible.map((b) => (
          <BalanceSentence
            key={b.currency}
            name={firstName(friend.user.name)}
            amount={b.amount}
            currency={b.currency}
            className="text-[13px]"
          />
        ))}
        {more > 0 && <p className="text-xs text-ink-3">+{more} more</p>}
        {bucket.usedFallbackRates && <p className="text-[11px] text-warn">est. rate</p>}
      </div>
    </Link>
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
          isLast={index === visible.length - 1}
          directBucketLabel={directBucketLabel}
          buildBucketHref={buildBucketHref}
          renderCompositionHint={renderCompositionHint}
        />
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowAll(true);
          }}
          className="block w-full py-2 text-left text-[13px] font-medium text-ink-3 transition-colors hover:text-ink"
        >
          +{hidden} more groups
        </button>
      )}
    </div>
  );
}
