'use client';

import type { CurrencyAmount, GroupBalancesDto, PublicUserDto } from '@divzy/shared';
import { collapsedBalanceEntries } from '@/lib/balance-display';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { BalanceSentence } from '@/components/friends/balance-sentence';
import type { SettleUpPrefill } from '@/components/settle/settle-dialog';

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

interface GroupMemberSettlementsProps {
  groupId: string;
  data: GroupBalancesDto;
  meId: string;
  onSettleUp: (prefill: SettleUpPrefill) => void;
}

interface MemberPosition {
  user: PublicUserDto;
  entries: CurrencyAmount[];
}

/**
 * Derive caller-relative positions from the existing pairwise exact-debts array.
 * Positive amounts mean the member owes the caller; negative means the caller owes
 * the member. Converted totals are summed from pairwise.convertedAmount when present;
 * unconverted rows stay as native leftovers.
 */
function derivePositions(data: GroupBalancesDto, meId: string): MemberPosition[] {
  return data.members
    .filter((m) => m.user.id !== meId)
    .map((m) => {
      const native: CurrencyAmount[] = [];
      let convertedTotal = 0;
      for (const row of data.pairwise) {
        if (row.fromUserId === meId && row.toUserId === m.user.id) {
          // Caller owes member.
          native.push({ currency: row.currency, amount: -row.amount });
          if (row.convertedAmount !== undefined) convertedTotal -= row.convertedAmount;
        } else if (row.fromUserId === m.user.id && row.toUserId === meId) {
          // Member owes caller.
          native.push({ currency: row.currency, amount: row.amount });
          if (row.convertedAmount !== undefined) convertedTotal += row.convertedAmount;
        }
      }
      const converted =
        convertedTotal !== 0
          ? { currency: data.viewerCurrency, amount: convertedTotal }
          : null;
      return { user: m.user, entries: collapsedBalanceEntries(converted, native) };
    });
}

/**
 * WI-084 group-detail panel: a caller-relative "who owes whom in this group" list
 * rendered above the existing suggestions section. Each member line is clickable
 * and opens the group-scoped SettleUpDialog pre-filled with the displayed amount.
 *
 * Derived entirely from the existing `GroupBalancesDto.pairwise` payload; no new
 * settlements endpoint is required.
 */
export function GroupMemberSettlements({ data, meId, onSettleUp }: GroupMemberSettlementsProps) {
  const positions = derivePositions(data, meId);
  const allSettled = positions.every((p) => p.entries.length === 0);

  if (allSettled) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm font-medium text-ink">All settled up in this group</p>
        <p className="text-[13px] text-ink-3">You and everyone else in this group are even.</p>
      </Card>
    );
  }

  return (
    <Card className="divide-y divide-hairline overflow-hidden">
      <div className="px-4 py-3">
        <h3 className="text-sm font-semibold text-ink">Who owes whom in this group</h3>
      </div>
      {positions.map(({ user, entries }) => {
        const settled = entries.length === 0;
        return (
          <div key={user.id} className="flex flex-col">
            {entries.slice(0, 2).map((line, index) => (
              <button
                key={line.currency}
                type="button"
                onClick={() =>
                  onSettleUp(
                    line.amount > 0
                      ? {
                          fromUserId: user.id,
                          toUserId: meId,
                          amount: line.amount,
                          currency: line.currency,
                        }
                      : {
                          fromUserId: meId,
                          toUserId: user.id,
                          amount: -line.amount,
                          currency: line.currency,
                        },
                  )
                }
                className="flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2 active:scale-[0.995]"
              >
                {index === 0 && <Avatar user={user} size="md" />}
                {index > 0 && <span aria-hidden="true" className="h-10 w-10 shrink-0" />}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {index === 0 ? user.name : ''}
                </span>
                <span className="shrink-0 text-[13px]">
                  <BalanceSentence
                    name={firstName(user.name)}
                    amount={line.amount}
                    currency={line.currency}
                  />
                </span>
              </button>
            ))}
            {entries.length > 2 && (
              <div className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-ink-3">
                <span aria-hidden="true" className="h-10 w-10 shrink-0" />
                <span>+{entries.length - 2} more</span>
              </div>
            )}
            {settled && (
              <div className="flex cursor-default items-center gap-3 px-4 py-2.5">
                <Avatar user={user} size="md" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{user.name}</span>
                <span className={cn('shrink-0 text-[13px] text-ink-3')}>Settled up</span>
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}
