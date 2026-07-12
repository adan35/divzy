import { allocate, assertValidAmount, sumAmounts } from './money';

export const SPLIT_TYPES = ['EQUAL', 'EXACT', 'PERCENT', 'SHARES', 'ADJUSTMENT', 'ITEMIZED'] as const;
export type SplitType = (typeof SPLIT_TYPES)[number];

export interface SplitParticipantInput {
  userId: string;
  /** EXACT: the exact amount this participant owes (minor units). */
  amount?: number;
  /** PERCENT: share in basis points (10000 = 100%). */
  percentBps?: number;
  /** SHARES: relative share count (integer >= 0). */
  shares?: number;
  /** ADJUSTMENT: +/- minor units applied on top of an equal base split. */
  adjustment?: number;
}

export interface SplitItemInput {
  name: string;
  amount: number;
  participantIds: string[];
}

export interface ComputeSplitsInput {
  splitType: SplitType;
  /** Total expense amount in minor units (> 0). */
  amount: number;
  participants: SplitParticipantInput[];
  /** ITEMIZED only. */
  items?: SplitItemInput[];
}

export interface ComputedSplit {
  userId: string;
  amount: number;
}

export type SplitErrorCode =
  | 'NO_PARTICIPANTS'
  | 'DUPLICATE_PARTICIPANT'
  | 'INVALID_AMOUNT'
  | 'EXACT_AMOUNT_REQUIRED'
  | 'EXACT_SUM_MISMATCH'
  | 'PERCENT_REQUIRED'
  | 'PERCENT_SUM_MISMATCH'
  | 'SHARES_REQUIRED'
  | 'SHARES_SUM_ZERO'
  | 'ADJUSTMENT_EXCEEDS_TOTAL'
  | 'NEGATIVE_SHARE'
  | 'ITEMS_REQUIRED'
  | 'ITEM_PARTICIPANT_UNKNOWN'
  | 'ITEMS_EXCEED_TOTAL'
  | 'INTERNAL_SUM_MISMATCH';

export class SplitError extends Error {
  constructor(
    readonly code: SplitErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SplitError';
  }
}

/**
 * Compute what each participant owes. Deterministic, exact: the returned
 * amounts always sum to `input.amount`. Participants may come out owing 0
 * (e.g. SHARES with 0 shares); callers decide whether to persist those rows.
 */
export function computeSplits(input: ComputeSplitsInput): ComputedSplit[] {
  const { splitType, amount, participants } = input;
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new SplitError('INVALID_AMOUNT', `Expense amount must be a positive integer, got ${amount}`);
  }
  assertValidAmount(amount, 'expense amount');
  if (participants.length === 0) throw new SplitError('NO_PARTICIPANTS', 'At least one participant is required');
  const ids = new Set(participants.map((p) => p.userId));
  if (ids.size !== participants.length) {
    throw new SplitError('DUPLICATE_PARTICIPANT', 'Participants must be unique');
  }

  let amounts: number[];
  switch (splitType) {
    case 'EQUAL': {
      amounts = allocate(amount, participants.map(() => 1));
      break;
    }
    case 'EXACT': {
      amounts = participants.map((p) => {
        if (p.amount === undefined || !Number.isInteger(p.amount) || p.amount < 0) {
          throw new SplitError('EXACT_AMOUNT_REQUIRED', `Exact amount missing/invalid for ${p.userId}`);
        }
        return p.amount;
      });
      const total = sumAmounts(amounts);
      if (total !== amount) {
        throw new SplitError('EXACT_SUM_MISMATCH', `Exact amounts sum to ${total}, expected ${amount}`);
      }
      break;
    }
    case 'PERCENT': {
      const bps = participants.map((p) => {
        if (p.percentBps === undefined || !Number.isInteger(p.percentBps) || p.percentBps < 0 || p.percentBps > 10000) {
          throw new SplitError('PERCENT_REQUIRED', `percentBps missing/invalid for ${p.userId}`);
        }
        return p.percentBps;
      });
      const totalBps = sumAmounts(bps);
      if (totalBps !== 10000) {
        throw new SplitError('PERCENT_SUM_MISMATCH', `Percentages sum to ${totalBps} bps, expected 10000`);
      }
      amounts = allocate(amount, bps);
      break;
    }
    case 'SHARES': {
      const shares = participants.map((p) => {
        if (p.shares === undefined || !Number.isInteger(p.shares) || p.shares < 0) {
          throw new SplitError('SHARES_REQUIRED', `shares missing/invalid for ${p.userId}`);
        }
        return p.shares;
      });
      if (sumAmounts(shares) === 0) throw new SplitError('SHARES_SUM_ZERO', 'At least one share is required');
      amounts = allocate(amount, shares);
      break;
    }
    case 'ADJUSTMENT': {
      const adjustments = participants.map((p) => {
        const adj = p.adjustment ?? 0;
        if (!Number.isInteger(adj)) throw new SplitError('INVALID_AMOUNT', `adjustment must be an integer for ${p.userId}`);
        return adj;
      });
      const base = amount - sumAmounts(adjustments);
      if (base < 0) {
        throw new SplitError('ADJUSTMENT_EXCEEDS_TOTAL', 'Adjustments exceed the expense amount');
      }
      const baseShares = allocate(base, participants.map(() => 1));
      amounts = baseShares.map((b, i) => b + (adjustments[i] ?? 0));
      if (amounts.some((a) => a < 0)) {
        throw new SplitError('NEGATIVE_SHARE', 'A participant share came out negative; reduce the adjustment');
      }
      break;
    }
    case 'ITEMIZED': {
      const items = input.items ?? [];
      if (items.length === 0) throw new SplitError('ITEMS_REQUIRED', 'Itemized splits need at least one item');
      const subtotals = new Map<string, number>(participants.map((p) => [p.userId, 0]));
      let itemsTotal = 0;
      for (const item of items) {
        if (!Number.isInteger(item.amount) || item.amount <= 0) {
          throw new SplitError('INVALID_AMOUNT', `Item "${item.name}" has an invalid amount`);
        }
        if (item.participantIds.length === 0) {
          throw new SplitError('ITEM_PARTICIPANT_UNKNOWN', `Item "${item.name}" has no participants`);
        }
        for (const id of item.participantIds) {
          if (!subtotals.has(id)) {
            throw new SplitError('ITEM_PARTICIPANT_UNKNOWN', `Item "${item.name}" references unknown participant ${id}`);
          }
        }
        itemsTotal += item.amount;
        const parts = allocate(item.amount, item.participantIds.map(() => 1));
        item.participantIds.forEach((id, i) => {
          subtotals.set(id, (subtotals.get(id) ?? 0) + (parts[i] ?? 0));
        });
      }
      const fee = amount - itemsTotal; // tax/tip/fees = declared total minus item sum
      if (fee < 0) throw new SplitError('ITEMS_EXCEED_TOTAL', 'Item amounts exceed the expense total');
      const orderedSubtotals = participants.map((p) => subtotals.get(p.userId) ?? 0);
      if (fee > 0) {
        const hasSubtotals = orderedSubtotals.some((s) => s > 0);
        const feeParts = allocate(fee, hasSubtotals ? orderedSubtotals : participants.map(() => 1));
        amounts = orderedSubtotals.map((s, i) => s + (feeParts[i] ?? 0));
      } else {
        amounts = orderedSubtotals;
      }
      break;
    }
  }

  const total = sumAmounts(amounts);
  if (total !== amount) {
    throw new SplitError('INTERNAL_SUM_MISMATCH', `Split engine bug: parts sum to ${total}, expected ${amount}`);
  }
  return participants.map((p, i) => ({ userId: p.userId, amount: amounts[i] ?? 0 }));
}

/**
 * Derive who-owes-whom for a single expense. Each debtor's share is allocated
 * across payers proportionally to what each payer contributed; self-debts
 * (payer owing themself) are dropped. Payers are sorted by userId first so the
 * result is deterministic regardless of input order.
 */
export function computePairwiseDebts(
  payers: readonly ComputedSplit[],
  splits: readonly ComputedSplit[],
): Array<{ fromUserId: string; toUserId: string; amount: number }> {
  const sortedPayers = [...payers].filter((p) => p.amount > 0).sort((a, b) => a.userId.localeCompare(b.userId));
  if (sortedPayers.length === 0) return [];
  const payerWeights = sortedPayers.map((p) => p.amount);
  const out: Array<{ fromUserId: string; toUserId: string; amount: number }> = [];
  for (const split of splits) {
    if (split.amount <= 0) continue;
    const parts = allocate(split.amount, payerWeights);
    sortedPayers.forEach((payer, i) => {
      const owed = parts[i] ?? 0;
      if (owed > 0 && payer.userId !== split.userId) {
        out.push({ fromUserId: split.userId, toUserId: payer.userId, amount: owed });
      }
    });
  }
  return out;
}
