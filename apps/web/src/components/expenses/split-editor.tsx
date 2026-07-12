'use client';

import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import {
  computeSplits,
  formatMoney,
  SplitError,
  type ComputedSplit,
  type ExpenseDto,
  type ExpenseItemInput,
  type ExpenseParticipantInput,
  type PublicUserDto,
  type SplitType,
} from '@divzy/shared';
import { AmountInput } from '@/components/ui/amount-input';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// State model — raw split INPUTS. Amounts are integer minor units throughout;
// the preview and the server run the exact same computeSplits().
// ---------------------------------------------------------------------------

export interface SplitItemRow {
  /** Stable client-side key for React lists. */
  key: string;
  name: string;
  amount: number | null;
  participantIds: string[];
}

export interface SplitState {
  splitType: SplitType;
  /** Checked participants (checkbox list, all on by default). */
  selectedIds: string[];
  exactAmounts: Record<string, number | null>;
  percentBps: Record<string, number | null>;
  shares: Record<string, number>;
  adjustments: Record<string, number | null>;
  items: SplitItemRow[];
}

let itemSeq = 0;
function nextItemKey(): string {
  itemSeq += 1;
  return `item-${itemSeq}`;
}

export function createDefaultSplitState(memberIds: string[]): SplitState {
  const shares: Record<string, number> = {};
  for (const id of memberIds) shares[id] = 1;
  return {
    splitType: 'EQUAL',
    selectedIds: [...memberIds],
    exactAmounts: {},
    percentBps: {},
    shares,
    adjustments: {},
    items: [],
  };
}

/** Reverse-map a saved expense back into raw editor inputs. */
export function splitStateFromExpense(expense: ExpenseDto): SplitState {
  const state = createDefaultSplitState(expense.splits.map((s) => s.user.id));
  state.splitType = expense.splitType;
  for (const split of expense.splits) {
    const id = split.user.id;
    if (expense.splitType === 'EXACT') state.exactAmounts[id] = split.amount;
    if (expense.splitType === 'PERCENT') state.percentBps[id] = split.percentBps ?? 0;
    if (expense.splitType === 'SHARES') state.shares[id] = split.shares ?? 1;
    if (expense.splitType === 'ADJUSTMENT') state.adjustments[id] = split.adjustment ?? 0;
  }
  if (expense.splitType === 'ITEMIZED') {
    state.items = expense.items.map((item) => ({
      key: nextItemKey(),
      name: item.name,
      amount: item.amount,
      participantIds: [...item.participantIds],
    }));
  }
  return state;
}

// ---------------------------------------------------------------------------
// Evaluation — build raw inputs + run the shared engine for the live preview.
// ---------------------------------------------------------------------------

export interface SplitEvaluation {
  /** Raw participant inputs, exactly as CreateExpenseInput wants them. */
  participants: ExpenseParticipantInput[];
  /** Item inputs (ITEMIZED only, undefined otherwise). */
  items: ExpenseItemInput[] | undefined;
  /** Per-person result from computeSplits, or null while invalid. */
  computed: ComputedSplit[] | null;
  /** Blocking problem (danger). */
  error: string | null;
  /** Non-blocking guidance (muted), e.g. "enter an amount first". */
  hint: string | null;
}

function friendlySplitError(err: SplitError): string {
  switch (err.code) {
    case 'EXACT_SUM_MISMATCH':
    case 'EXACT_AMOUNT_REQUIRED':
      return 'The amounts must add up to the expense total.';
    case 'PERCENT_SUM_MISMATCH':
    case 'PERCENT_REQUIRED':
      return 'Percentages must add up to 100%.';
    case 'SHARES_SUM_ZERO':
    case 'SHARES_REQUIRED':
      return 'Give at least one person a share.';
    case 'ADJUSTMENT_EXCEEDS_TOTAL':
      return 'The adjustments add up to more than the expense total.';
    case 'NEGATIVE_SHARE':
      return 'A share came out negative — reduce that adjustment.';
    case 'ITEMS_REQUIRED':
      return 'Add at least one item.';
    case 'ITEMS_EXCEED_TOTAL':
      return 'The items add up to more than the expense total.';
    case 'ITEM_PARTICIPANT_UNKNOWN':
      return 'Every item needs at least one selected person.';
    case 'NO_PARTICIPANTS':
      return 'Select at least one person.';
    default:
      return err.message;
  }
}

/**
 * Validate the current split inputs against the expense amount by running the
 * shared computeSplits (the exact server math). Never throws.
 */
export function evaluateSplit(state: SplitState, amount: number | null): SplitEvaluation {
  const selected = state.selectedIds;
  const base: Omit<SplitEvaluation, 'computed' | 'error' | 'hint'> = {
    participants: [],
    items: undefined,
  };

  if (selected.length === 0) {
    return { ...base, computed: null, error: 'Select at least one person.', hint: null };
  }

  let participants: ExpenseParticipantInput[];
  let items: ExpenseItemInput[] | undefined;

  switch (state.splitType) {
    case 'EQUAL':
      participants = selected.map((userId) => ({ userId }));
      break;
    case 'EXACT':
      participants = selected.map((userId) => ({
        userId,
        amount: state.exactAmounts[userId] ?? 0,
      }));
      break;
    case 'PERCENT':
      participants = selected.map((userId) => ({
        userId,
        percentBps: state.percentBps[userId] ?? 0,
      }));
      break;
    case 'SHARES':
      participants = selected.map((userId) => ({
        userId,
        shares: state.shares[userId] ?? 1,
      }));
      break;
    case 'ADJUSTMENT':
      participants = selected.map((userId) => ({
        userId,
        adjustment: state.adjustments[userId] ?? 0,
      }));
      break;
    case 'ITEMIZED': {
      participants = selected.map((userId) => ({ userId }));
      if (state.items.length === 0) {
        return { participants, items: undefined, computed: null, error: 'Add at least one item.', hint: null };
      }
      items = [];
      for (const row of state.items) {
        const name = row.name.trim();
        const rowParticipants = [...new Set(row.participantIds)].filter((id) => selected.includes(id));
        if (!name || row.amount === null || row.amount <= 0) {
          return {
            participants,
            items: undefined,
            computed: null,
            error: 'Every item needs a name and an amount.',
            hint: null,
          };
        }
        if (rowParticipants.length === 0) {
          return {
            participants,
            items: undefined,
            computed: null,
            error: 'Every item needs at least one person.',
            hint: null,
          };
        }
        items.push({ name, amount: row.amount, participantIds: rowParticipants });
      }
      break;
    }
  }

  if (amount === null || amount <= 0) {
    return {
      participants,
      items,
      computed: null,
      error: null,
      hint: 'Enter the expense amount to preview the split.',
    };
  }

  try {
    const computed = computeSplits({ splitType: state.splitType, amount, participants, items });
    return { participants, items, computed, error: null, hint: null };
  } catch (err) {
    if (err instanceof SplitError) {
      return { participants, items, computed: null, error: friendlySplitError(err), hint: null };
    }
    return {
      participants,
      items,
      computed: null,
      error: err instanceof Error ? err.message : 'This split is not valid yet.',
      hint: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Percent input (UI percent text <-> integer basis points)
// ---------------------------------------------------------------------------

function percentTextToBps(text: string): number | null {
  const normalized = text.startsWith('.') ? `0${text}` : text.replace(/\.$/, '');
  if (normalized === '') return null;
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const frac = (match[2] ?? '').padEnd(2, '0');
  const bps = Number(match[1]) * 100 + (frac === '' ? 0 : Number(frac));
  return bps;
}

function bpsToPercentText(bps: number | null): string {
  if (bps === null) return '';
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  if (frac === 0) return String(whole);
  const fracText = String(frac).padStart(2, '0').replace(/0$/, '');
  return `${whole}.${fracText}`;
}

function PercentInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: number | null;
  onChange: (bps: number | null) => void;
  ariaLabel: string;
}) {
  const [text, setText] = useState(() => bpsToPercentText(value));
  const lastEmitted = useRef<number | null>(value);

  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setText(bpsToPercentText(value));
    }
  }, [value]);

  const handleChange = (raw: string) => {
    const normalized = raw.replace(/,/g, '.');
    if (!/^\d{0,3}(?:\.\d{0,2})?$/.test(normalized)) return;
    const parsed = percentTextToBps(normalized);
    if (parsed !== null && parsed > 10000) return;
    setText(normalized);
    lastEmitted.current = parsed;
    onChange(parsed);
  };

  return (
    <div className="flex h-9 w-24 items-center overflow-hidden rounded-[10px] border border-hairline bg-surface transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-soft">
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={ariaLabel}
        value={text}
        placeholder="0"
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => setText(bpsToPercentText(percentTextToBps(text.replace(/,/g, '.')))) }
        className="h-full w-full bg-transparent pl-3 text-right text-sm tabular-nums text-ink placeholder:text-ink-3 focus:outline-none"
      />
      <span className="select-none pl-1 pr-2.5 text-sm text-ink-3" aria-hidden="true">
        %
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function StepperButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-lg border border-hairline text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** "left to assign" running indicator for EXACT / PERCENT modes. */
function RemainingLine({ remaining, format }: { remaining: number; format: (v: number) => string }) {
  if (remaining === 0) {
    return <p className="text-right text-[13px] font-medium text-pos">All assigned ✓</p>;
  }
  return (
    <p className={cn('text-right text-[13px] font-medium', remaining > 0 ? 'text-warn' : 'text-neg')}>
      {format(Math.abs(remaining))} {remaining > 0 ? 'left to assign' : 'over'}
    </p>
  );
}

const SPLIT_OPTIONS: ReadonlyArray<{ value: SplitType; label: string; title: string }> = [
  { value: 'EQUAL', label: '=', title: 'Split equally' },
  { value: 'EXACT', label: '1.23', title: 'Exact amounts' },
  { value: 'PERCENT', label: '%', title: 'Percentages' },
  { value: 'SHARES', label: 'shares', title: 'By shares' },
  { value: 'ADJUSTMENT', label: '±', title: 'Adjustments' },
  { value: 'ITEMIZED', label: 'items', title: 'By items' },
];

// ---------------------------------------------------------------------------
// SplitEditor
// ---------------------------------------------------------------------------

export interface SplitEditorProps {
  members: PublicUserDto[];
  meId: string;
  /** Expense total in minor units (null while unentered). */
  amount: number | null;
  currency: string;
  value: SplitState;
  onChange: (next: SplitState) => void;
}

/**
 * The split-type segmented control + per-mode participant inputs + a live
 * per-person preview computed with the shared split engine on every change.
 */
export function SplitEditor({ members, meId, amount, currency, value, onChange }: SplitEditorProps) {
  const memberById = new Map(members.map((m) => [m.id, m]));
  const selectedSet = new Set(value.selectedIds);
  const evaluation = evaluateSplit(value, amount);
  // Local +/- sign per member for ADJUSTMENT mode (sign survives while the
  // amount box is empty). Initialized from prefilled negative adjustments.
  const [signs, setSigns] = useState<Record<string, 1 | -1>>(() => {
    const initial: Record<string, 1 | -1> = {};
    for (const [id, adj] of Object.entries(value.adjustments)) {
      if (adj !== null && adj < 0) initial[id] = -1;
    }
    return initial;
  });

  const set = (patch: Partial<SplitState>) => onChange({ ...value, ...patch });

  const setSplitType = (splitType: SplitType) => {
    if (splitType === 'ITEMIZED' && value.items.length === 0) {
      set({
        splitType,
        items: [{ key: nextItemKey(), name: '', amount: null, participantIds: [...value.selectedIds] }],
      });
      return;
    }
    set({ splitType });
  };

  const toggleMember = (id: string) => {
    const next = selectedSet.has(id)
      ? value.selectedIds.filter((x) => x !== id)
      : [...value.selectedIds, id];
    set({ selectedIds: next });
  };

  const updateItem = (key: string, patch: Partial<SplitItemRow>) => {
    set({ items: value.items.map((row) => (row.key === key ? { ...row, ...patch } : row)) });
  };

  const toggleItemParticipant = (key: string, userId: string) => {
    set({
      items: value.items.map((row) => {
        if (row.key !== key) return row;
        const has = row.participantIds.includes(userId);
        return {
          ...row,
          participantIds: has
            ? row.participantIds.filter((x) => x !== userId)
            : [...row.participantIds, userId],
        };
      }),
    });
  };

  const memberName = (id: string) => {
    if (id === meId) return 'You';
    return memberById.get(id)?.name ?? 'Former member';
  };

  // Running indicators for the modes that must reach exactly zero.
  const exactAssigned = value.selectedIds.reduce((acc, id) => acc + (value.exactAmounts[id] ?? 0), 0);
  const percentAssigned = value.selectedIds.reduce((acc, id) => acc + (value.percentBps[id] ?? 0), 0);
  const itemsAssigned = value.items.reduce((acc, row) => acc + (row.amount ?? 0), 0);
  const fee = amount !== null ? amount - itemsAssigned : null;

  const selectedMembers = members.filter((m) => selectedSet.has(m.id));

  const rightControl = (member: PublicUserDto) => {
    switch (value.splitType) {
      case 'EQUAL':
        return null;
      case 'EXACT':
        return (
          <AmountInput
            className="h-9 w-32"
            currency={currency}
            value={value.exactAmounts[member.id] ?? null}
            onChange={(v) => set({ exactAmounts: { ...value.exactAmounts, [member.id]: v } })}
            aria-label={`Exact amount for ${member.name}`}
          />
        );
      case 'PERCENT':
        return (
          <PercentInput
            value={value.percentBps[member.id] ?? null}
            onChange={(bps) => set({ percentBps: { ...value.percentBps, [member.id]: bps } })}
            ariaLabel={`Percentage for ${member.name}`}
          />
        );
      case 'SHARES': {
        const shares = value.shares[member.id] ?? 1;
        return (
          <div className="flex items-center gap-1.5">
            <StepperButton
              label={`Fewer shares for ${member.name}`}
              disabled={shares <= 0}
              onClick={() => set({ shares: { ...value.shares, [member.id]: Math.max(0, shares - 1) } })}
            >
              <Minus className="h-3.5 w-3.5" aria-hidden="true" />
            </StepperButton>
            <span className="w-7 text-center text-sm tabular-nums text-ink">{shares}</span>
            <StepperButton
              label={`More shares for ${member.name}`}
              onClick={() => set({ shares: { ...value.shares, [member.id]: shares + 1 } })}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </StepperButton>
          </div>
        );
      }
      case 'ADJUSTMENT': {
        const stored = value.adjustments[member.id] ?? null;
        const sign: 1 | -1 = signs[member.id] ?? (stored !== null && stored < 0 ? -1 : 1);
        return (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label={`${sign === 1 ? 'Subtract from' : 'Add to'} ${member.name}'s share`}
              title={sign === 1 ? 'Adds on top of the equal share' : 'Subtracts from the equal share'}
              onClick={() => {
                const nextSign: 1 | -1 = sign === 1 ? -1 : 1;
                setSigns((s) => ({ ...s, [member.id]: nextSign }));
                if (stored !== null && stored !== 0) {
                  set({ adjustments: { ...value.adjustments, [member.id]: Math.abs(stored) * nextSign } });
                }
              }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-hairline text-sm font-semibold text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              {sign === 1 ? '+' : '−'}
            </button>
            <AmountInput
              className="h-9 w-28"
              currency={currency}
              value={stored === null ? null : Math.abs(stored)}
              onChange={(v) =>
                set({ adjustments: { ...value.adjustments, [member.id]: v === null ? null : v * sign } })
              }
              aria-label={`Adjustment for ${member.name}`}
            />
          </div>
        );
      }
      case 'ITEMIZED':
        return null;
    }
  };

  return (
    <div className="space-y-3">
      <SegmentedControl
        aria-label="Split type"
        options={SPLIT_OPTIONS.map((o) => ({
          value: o.value,
          label: (
            <span title={o.title} className={o.value === 'EXACT' ? 'tabular-nums' : undefined}>
              {o.label}
            </span>
          ),
        }))}
        value={value.splitType}
        onChange={setSplitType}
      />

      {value.splitType === 'ADJUSTMENT' && (
        <p className="text-[13px] text-ink-3">
          Enter + or − amounts per person — the rest splits equally.
        </p>
      )}

      {/* Participant checkbox list */}
      <div className="scrollbar-thin max-h-60 space-y-0.5 overflow-y-auto rounded-xl border border-hairline p-2">
        {members.map((member) => {
          const checked = selectedSet.has(member.id);
          const checkboxId = `split-member-${member.id}`;
          return (
            <div key={member.id} className="flex min-h-10 items-center gap-2.5 rounded-lg px-2 py-1">
              <input
                id={checkboxId}
                type="checkbox"
                checked={checked}
                onChange={() => toggleMember(member.id)}
                className="h-4 w-4 shrink-0 cursor-pointer accent-brand"
                aria-label={`Include ${member.name}`}
              />
              <label
                htmlFor={checkboxId}
                className={cn(
                  'flex min-w-0 flex-1 cursor-pointer items-center gap-2',
                  !checked && 'opacity-50',
                )}
              >
                <Avatar user={member} size="sm" />
                <span className="truncate text-sm text-ink">
                  {member.name}
                  {member.id === meId && <span className="text-ink-3"> (you)</span>}
                </span>
              </label>
              {checked && rightControl(member)}
            </div>
          );
        })}
      </div>

      {value.splitType === 'EXACT' && amount !== null && (
        <RemainingLine
          remaining={amount - exactAssigned}
          format={(v) => formatMoney(v, currency)}
        />
      )}
      {value.splitType === 'PERCENT' && (
        <RemainingLine
          remaining={10000 - percentAssigned}
          format={(v) => `${bpsToPercentText(v) || '0'}%`}
        />
      )}

      {/* Itemized rows */}
      {value.splitType === 'ITEMIZED' && (
        <div className="space-y-2.5">
          {value.items.map((row) => (
            <div key={row.key} className="space-y-2 rounded-xl border border-hairline p-3">
              <div className="flex items-center gap-2">
                <Input
                  value={row.name}
                  maxLength={140}
                  placeholder="Item name"
                  aria-label="Item name"
                  onChange={(e) => updateItem(row.key, { name: e.target.value })}
                  className="h-9 flex-1"
                />
                <AmountInput
                  className="h-9 w-28 shrink-0"
                  currency={currency}
                  value={row.amount}
                  onChange={(v) => updateItem(row.key, { amount: v })}
                  aria-label="Item amount"
                />
                <button
                  type="button"
                  aria-label="Remove item"
                  onClick={() => set({ items: value.items.filter((r) => r.key !== row.key) })}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-ink-3 transition-colors hover:bg-neg-soft hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedMembers.map((member) => {
                  const active = row.participantIds.includes(member.id);
                  return (
                    <button
                      key={member.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleItemParticipant(row.key, member.id)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2.5 text-xs font-medium transition-colors',
                        active
                          ? 'bg-brand-soft text-brand'
                          : 'bg-surface-2 text-ink-3 hover:text-ink',
                      )}
                    >
                      <Avatar user={member} size="xs" />
                      {member.id === meId ? 'You' : firstName(member.name)}
                    </button>
                  );
                })}
                {selectedMembers.length === 0 && (
                  <span className="text-xs text-ink-3">Select people above to assign this item.</span>
                )}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                set({
                  items: [
                    ...value.items,
                    { key: nextItemKey(), name: '', amount: null, participantIds: [...value.selectedIds] },
                  ],
                })
              }
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add item
            </Button>
            {amount !== null && fee !== null && (
              <span
                className={cn(
                  'text-right text-[13px] tabular-nums',
                  fee < 0 ? 'font-medium text-neg' : 'text-ink-3',
                )}
              >
                Items {formatMoney(itemsAssigned, currency)}
                {fee > 0 && <> · tax/tip {formatMoney(fee, currency)}</>}
                {fee < 0 && <> — {formatMoney(-fee, currency)} over the total</>}
              </span>
            )}
          </div>
          <p className="text-[13px] text-ink-3">
            Total minus items = tax/tip, split proportionally.
          </p>
        </div>
      )}

      {/* Live preview — same math as the server */}
      {evaluation.computed ? (
        <div className="rounded-xl border border-hairline bg-surface-2 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Preview</p>
          <ul className="scrollbar-thin max-h-44 space-y-1.5 overflow-y-auto">
            {evaluation.computed.map((split) => (
              <li key={split.userId} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  {memberById.get(split.userId) && (
                    <Avatar user={memberById.get(split.userId)!} size="xs" />
                  )}
                  <span className="truncate text-ink">{memberName(split.userId)}</span>
                </span>
                <span className="whitespace-nowrap text-ink-2">
                  owes <span className="font-medium tabular-nums text-ink">{formatMoney(split.amount, currency)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : evaluation.error ? (
        <p className="text-[13px] font-medium text-danger" role="alert">
          {evaluation.error}
        </p>
      ) : evaluation.hint ? (
        <p className="text-[13px] text-ink-3">{evaluation.hint}</p>
      ) : null}
    </div>
  );
}
