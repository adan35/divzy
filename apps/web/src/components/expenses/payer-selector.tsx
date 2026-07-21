'use client';

import { Check, ChevronDown, Users } from 'lucide-react';
import type { ExpenseDto, ExpensePayerInput, PublicUserDto } from '@divzy/shared';
import { AmountInput } from '@/components/ui/amount-input';
import { Avatar } from '@/components/ui/avatar';
import { Dropdown, DropdownItem, DropdownSeparator } from '@/components/ui/dropdown';
import { MoneyText } from '@/components/ui/money-text';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// State model
// ---------------------------------------------------------------------------

export interface PayerState {
  mode: 'single' | 'multi';
  /** Single-payer user id (defaults to "you"). */
  singleId: string;
  /** Per-member contributions in minor units (multi mode). */
  multiAmounts: Record<string, number | null>;
}

export function createDefaultPayerState(meId: string): PayerState {
  return { mode: 'single', singleId: meId, multiAmounts: {} };
}

/** Prefill from a saved expense (edit mode). */
export function payerStateFromExpense(expense: ExpenseDto, meId: string): PayerState {
  if (expense.payers.length === 1) {
    return { mode: 'single', singleId: expense.payers[0]!.user.id, multiAmounts: {} };
  }
  const multiAmounts: Record<string, number | null> = {};
  for (const payer of expense.payers) multiAmounts[payer.user.id] = payer.amount;
  return { mode: 'multi', singleId: meId, multiAmounts };
}

/**
 * Build the payers array for CreateExpenseInput. Returns null while invalid
 * (multi-payer contributions must sum exactly to the expense amount).
 */
export function buildPayers(state: PayerState, amount: number | null): ExpensePayerInput[] | null {
  if (amount === null || amount <= 0) return null;
  if (state.mode === 'single') return [{ userId: state.singleId, amount }];
  const entries: ExpensePayerInput[] = [];
  let sum = 0;
  for (const [userId, value] of Object.entries(state.multiAmounts)) {
    if (value !== null && value > 0) {
      entries.push({ userId, amount: value });
      sum += value;
    }
  }
  if (entries.length === 0 || sum !== amount) return null;
  return entries;
}

// ---------------------------------------------------------------------------
// PayerSelector
// ---------------------------------------------------------------------------

export interface PayerSelectorProps {
  members: PublicUserDto[];
  meId: string;
  amount: number | null;
  currency: string;
  value: PayerState;
  onChange: (next: PayerState) => void;
}

/**
 * "Paid by" control: a popover to pick a single payer or switch to
 * multiple-payers mode, which reveals per-member amount inputs with a live
 * "left to assign" indicator (must reach exactly zero).
 */
export function PayerSelector({ members, meId, amount, currency, value, onChange }: PayerSelectorProps) {
  const memberById = new Map(members.map((m) => [m.id, m]));

  const displayName = (id: string) => (id === meId ? 'you' : memberById.get(id)?.name ?? 'Former member');

  if (value.mode === 'multi') {
    const assigned = members.reduce((acc, m) => acc + (value.multiAmounts[m.id] ?? 0), 0);
    const remaining = amount !== null ? amount - assigned : null;
    return (
      <div className="space-y-2 rounded-xl border border-hairline p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium text-ink-2">Paid by multiple people</span>
          <button
            type="button"
            onClick={() => onChange({ ...value, mode: 'single' })}
            className="text-[13px] font-medium text-brand transition-colors hover:text-brand-hover"
          >
            Single payer
          </button>
        </div>
        <div className="scrollbar-thin max-h-52 space-y-1 overflow-y-auto">
          {members.map((member) => (
            <div key={member.id} className="flex items-center gap-2.5 py-0.5">
              <Avatar user={member} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {member.name}
                {member.id === meId && <span className="text-ink-3"> (you)</span>}
              </span>
              <AmountInput
                className="h-9 w-32"
                currency={currency}
                value={value.multiAmounts[member.id] ?? null}
                onChange={(v) =>
                  onChange({ ...value, multiAmounts: { ...value.multiAmounts, [member.id]: v } })
                }
                aria-label={`Amount paid by ${member.name}`}
              />
            </div>
          ))}
        </div>
        {remaining === null ? (
          <p className="text-right text-[13px] text-ink-3">Enter the expense amount to assign payments.</p>
        ) : remaining === 0 ? (
          <p className="text-right text-[13px] font-medium text-pos">All assigned ✓</p>
        ) : (
          <p
            className={cn(
              'flex items-center justify-end gap-1 text-right text-[13px] font-medium',
              remaining > 0 ? 'text-warn' : 'text-neg',
            )}
          >
            <MoneyText amount={Math.abs(remaining)} currency={currency} />
            {remaining > 0 ? 'left to assign' : 'over'}
          </p>
        )}
      </div>
    );
  }

  const selected = memberById.get(value.singleId);

  return (
    <Dropdown
      align="start"
      className="w-full"
      contentClassName="w-full min-w-[240px] max-h-72 overflow-y-auto scrollbar-thin"
      trigger={
        <span className="flex h-10 w-full items-center justify-between gap-2 rounded-[10px] border border-hairline bg-surface px-3 text-sm text-ink transition-colors hover:bg-surface-2">
          <span className="flex min-w-0 items-center gap-2">
            {selected && <Avatar user={selected} size="xs" />}
            <span className="truncate">
              Paid by <span className="font-medium">{displayName(value.singleId)}</span>
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
        </span>
      }
    >
      {members.map((member) => (
        <DropdownItem
          key={member.id}
          onSelect={() => onChange({ ...value, mode: 'single', singleId: member.id })}
        >
          <span className="flex items-center gap-2.5">
            <Avatar user={member} size="xs" />
            <span className="min-w-0 flex-1 truncate">
              {member.name}
              {member.id === meId && <span className="text-ink-3"> (you)</span>}
            </span>
            {member.id === value.singleId && (
              <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
            )}
          </span>
        </DropdownItem>
      ))}
      <DropdownSeparator />
      <DropdownItem
        icon={<Users />}
        onSelect={() => {
          // Seed the current single payer with the full amount so the user
          // only redistributes instead of retyping everything.
          const seeded: Record<string, number | null> = { ...value.multiAmounts };
          if (amount !== null && amount > 0 && Object.values(seeded).every((v) => !v)) {
            seeded[value.singleId] = amount;
          }
          onChange({ ...value, mode: 'multi', multiAmounts: seeded });
        }}
      >
        Multiple people
      </DropdownItem>
    </Dropdown>
  );
}
