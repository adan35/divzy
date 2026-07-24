'use client';

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

/**
 * One bucket ledger line (spec-WI-079 D7/D8/D9/D12): `{emoji} {group name}`
 * on the left — or the "Direct expenses" copy, no emoji, secondary styling,
 * for the `group: null` bucket — and the collapsed converted+leftover amounts
 * on the right via the exact `collapsedBalanceEntries` helper the collapsed
 * rows already use, capped at 2 entries with the existing "+N more" tail.
 * The per-bucket `est. rate` notice renders only when THIS bucket's
 * `usedFallbackRates` is set (per-bucket attribution, never blanket).
 */
function BucketLine({ bucket, friendName }: { bucket: FriendBalanceBucket; friendName: string }) {
  const entries = collapsedBalanceEntries(bucket.balancesConverted, bucket.balances);
  const visible = entries.slice(0, 2);
  const more = entries.length - visible.length;

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <p
        className={cn(
          'min-w-0 truncate text-[13px]',
          bucket.group ? 'text-ink-2' : 'text-ink-3',
        )}
      >
        {bucket.group ? `${bucket.group.emoji} ${bucket.group.name}` : 'Direct expenses'}
      </p>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        {visible.map((b) => (
          <BalanceSentence
            key={b.currency}
            name={firstName(friendName)}
            amount={b.amount}
            currency={b.currency}
            className="text-[13px]"
          />
        ))}
        {more > 0 && <p className="text-xs text-ink-3">+{more} more</p>}
        {bucket.usedFallbackRates && <p className="text-[11px] text-warn">est. rate</p>}
      </div>
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
export function FriendBalanceBreakdown({ friend }: { friend: FriendDto }) {
  const [showAll, setShowAll] = useState(false);
  const buckets = friend.balancesByGroup;
  const collapsedOverflow = buckets.length > BUCKET_OVERFLOW_THRESHOLD && !showAll;
  const visible = collapsedOverflow ? buckets.slice(0, BUCKET_OVERFLOW_VISIBLE) : buckets;
  const hidden = buckets.length - visible.length;

  return (
    <div className="divide-y divide-hairline border-t border-hairline px-4 py-2">
      {visible.map((bucket) => (
        <BucketLine
          key={bucket.group?.id ?? 'direct'}
          bucket={bucket}
          friendName={friend.user.name}
        />
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="block w-full py-2 text-left text-[13px] font-medium text-ink-3 transition-colors hover:text-ink"
        >
          +{hidden} more groups
        </button>
      )}
    </div>
  );
}
