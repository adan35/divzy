import {
  computeSplits,
  SplitError,
  type ComputedSplit,
  type ExpenseDto,
  type ExpenseItemInput,
  type ExpenseParticipantInput,
  type ExpensePayerInput,
  type SplitType,
} from '@divzy/shared';

// ---------------------------------------------------------------------------
// Split state — raw split INPUTS, mirroring the web editor exactly. Amounts
// are integer minor units throughout; the live preview and the server run the
// very same computeSplits() from @divzy/shared.
// ---------------------------------------------------------------------------

export interface SplitItemRow {
  /** Stable client-side key for list rendering. */
  key: string;
  name: string;
  amount: number | null;
  participantIds: string[];
}

export interface SplitState {
  splitType: SplitType;
  /** Checked participants (all members on by default). */
  selectedIds: string[];
  exactAmounts: Record<string, number | null>;
  percentBps: Record<string, number | null>;
  shares: Record<string, number>;
  adjustments: Record<string, number | null>;
  items: SplitItemRow[];
}

let itemSeq = 0;
export function nextItemKey(): string {
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

/** Reverse-map a saved expense back into raw editor inputs (edit mode). */
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
        return {
          participants,
          items: undefined,
          computed: null,
          error: 'Add at least one item.',
          hint: null,
        };
      }
      items = [];
      for (const row of state.items) {
        const name = row.name.trim();
        const rowParticipants = [...new Set(row.participantIds)].filter((id) =>
          selected.includes(id),
        );
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
// Payer state
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
// Percent text <-> basis points (PercentInput helpers)
// ---------------------------------------------------------------------------

export function percentTextToBps(text: string): number | null {
  const normalized = text.startsWith('.') ? `0${text}` : text.replace(/\.$/, '');
  if (normalized === '') return null;
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const frac = (match[2] ?? '').padEnd(2, '0');
  return Number(match[1]) * 100 + (frac === '' ? 0 : Number(frac));
}

export function bpsToPercentText(bps: number | null): string {
  if (bps === null) return '';
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  if (frac === 0) return String(whole);
  const fracText = String(frac).padStart(2, '0').replace(/0$/, '');
  return `${whole}.${fracText}`;
}

/** First name for compact chips: "Sam Lee" -> "Sam". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
