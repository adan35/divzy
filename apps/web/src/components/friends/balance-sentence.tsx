'use client';

import { MoneyText } from '@/components/ui/money-text';
import { cn } from '@/lib/utils';

export interface BalanceSentenceProps {
  /** The other person's display name (e.g. "Sam" or "Sam Lee"). */
  name: string;
  /** Net amount from the current user's perspective. Positive = they owe you. */
  amount: number;
  currency: string;
  className?: string;
}

/**
 * Balance as a sentence per STYLE.md — "Sam owes you $12.50", never a bare
 * signed number. Color pairs with the wording (green = owed to you,
 * red = you owe, muted = settled).
 */
export function BalanceSentence({ name, amount, currency, className }: BalanceSentenceProps) {
  if (amount === 0) {
    return <span className={cn('text-ink-3', className)}>You and {name} are settled up</span>;
  }
  if (amount > 0) {
    return (
      <span className={cn('text-pos', className)}>
        {name} owes you <MoneyText amount={amount} currency={currency} className="font-medium" />
      </span>
    );
  }
  return (
    <span className={cn('text-neg', className)}>
      You owe {name} <MoneyText amount={-amount} currency={currency} className="font-medium" />
    </span>
  );
}
