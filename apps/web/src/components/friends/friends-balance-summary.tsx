'use client';

import { useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { computeFriendsSummary, type FriendDto } from '@divzy/shared';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { FallbackRatesNotice } from '@/components/ui/fallback-rates-notice';
import { MoneyText } from '@/components/ui/money-text';

export interface FriendsBalanceSummaryProps {
  /**
   * The FULL, unfiltered friends list (`friends.data`) — never the WI-037
   * `filtered` array. The summary is deliberately filter-independent
   * (spec-WI-049 §2.2).
   */
  friends: readonly FriendDto[];
}

/**
 * WI-049 — accumulated "who owes what" summary at the top of the Friends
 * list, above the WI-037 filter. Computed client-side over `FriendDto[]` via
 * the shared `computeFriendsSummary` helper (spec-WI-049 §2/§3) rather than a
 * server-aggregated DTO — no new endpoint.
 *
 * WI-068 §6/§9.1: restyled from a 3-`StatCard` grid into a compact
 * "mini-Pulse" chip strip — a net headline (icon-based settled check, never
 * emoji-as-icon) plus `pos-soft`/`neg-soft` owe/owed chips, hidden when zero,
 * mirroring the dashboard Pulse hero's chip convention at a smaller scale.
 *
 * Renders nothing when `friends` is empty (spec-WI-049 §2.4 "Empty friends
 * list") — the caller already guards on this, this is defense-in-depth.
 */
export function FriendsBalanceSummary({ friends }: FriendsBalanceSummaryProps) {
  const summary = useMemo(() => computeFriendsSummary(friends), [friends]);

  if (friends.length === 0) return null;

  const settled = !summary.hasConvertible && !summary.hasUnresolved;
  // `summary.currency` is null only when no friend had a convertible figure.
  // In that case youAreOwed/youOwe are necessarily both 0, so this fallback
  // only affects which currency symbol a "0" reads in — never the amount.
  const displayCurrency = summary.currency ?? summary.unresolvedCurrencies[0]?.currency ?? 'USD';

  return (
    <div className="space-y-3">
      {summary.usedFallbackRates && <FallbackRatesNotice />}

      <Card className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink-2">Overall</p>
          {settled ? (
            <p className="mt-1 flex items-center gap-1.5 text-[15px] font-semibold text-ink">
              <CheckCircle2 className="h-4 w-4 text-pos" aria-hidden="true" />
              All settled up
            </p>
          ) : (
            <MoneyText
              amount={summary.net}
              currency={displayCurrency}
              mode="signed-color"
              className="mt-1 block text-xl font-semibold"
            />
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {summary.youOwe > 0 && (
            <Badge variant="neg" className="px-2.5 py-1 text-[13px]">
              You owe <MoneyText amount={summary.youOwe} currency={displayCurrency} />
            </Badge>
          )}
          {summary.youAreOwed > 0 && (
            <Badge variant="pos" className="px-2.5 py-1 text-[13px]">
              You&rsquo;re owed <MoneyText amount={summary.youAreOwed} currency={displayCurrency} />
            </Badge>
          )}
        </div>
      </Card>

      {summary.hasUnresolved && (
        <Card className="space-y-1.5 p-4">
          <p className="text-[13px] font-medium text-ink-2">Not yet converted</p>
          {summary.unresolvedCurrencies.map((entry) => (
            <p key={entry.currency} className="text-sm text-ink-2">
              <MoneyText amount={entry.amount} currency={entry.currency} />{' '}
              <span className="text-ink-3">unconverted</span>
            </p>
          ))}
        </Card>
      )}
    </div>
  );
}
