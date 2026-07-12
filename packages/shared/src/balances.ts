import { computePairwiseDebts, type ComputedSplit } from './split';
import { simplifyDebts, type Transfer } from './simplify';

export interface LedgerExpense {
  currency: string;
  payers: ComputedSplit[];
  splits: ComputedSplit[];
}

export interface LedgerSettlement {
  currency: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
}

export interface CurrencyAmount {
  currency: string;
  amount: number;
}

export interface PairwiseDebt {
  currency: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
}

export type NetsByCurrency = Map<string, Map<string, number>>;

/**
 * Net position per user per currency. net = paid − owed (+ settlements sent −
 * settlements received). Positive = the group owes this user money.
 * Zero-sum per currency by construction.
 */
export function computeNets(
  expenses: readonly LedgerExpense[],
  settlements: readonly LedgerSettlement[],
): NetsByCurrency {
  const nets: NetsByCurrency = new Map();
  const bump = (currency: string, userId: string, delta: number) => {
    let perUser = nets.get(currency);
    if (!perUser) {
      perUser = new Map();
      nets.set(currency, perUser);
    }
    perUser.set(userId, (perUser.get(userId) ?? 0) + delta);
  };

  for (const e of expenses) {
    for (const p of e.payers) bump(e.currency, p.userId, p.amount);
    for (const s of e.splits) bump(e.currency, s.userId, -s.amount);
  }
  for (const s of settlements) {
    bump(s.currency, s.fromUserId, s.amount);
    bump(s.currency, s.toUserId, -s.amount);
  }
  return nets;
}

/**
 * Who-owes-whom, exactly as incurred (no simplification). Settlements reduce
 * (and can flip) the pairwise debt between the two users involved.
 */
export function computePairwiseBalances(
  expenses: readonly LedgerExpense[],
  settlements: readonly LedgerSettlement[],
): PairwiseDebt[] {
  // key: `${currency}|${lowUserId}|${highUserId}` -> amount owed by low to high (signed)
  const ledger = new Map<string, number>();
  const bump = (currency: string, from: string, to: string, amount: number) => {
    const [low, high] = from < to ? [from, to] : [to, from];
    const signed = from === low ? amount : -amount;
    const key = `${currency}|${low}|${high}`;
    ledger.set(key, (ledger.get(key) ?? 0) + signed);
  };

  for (const e of expenses) {
    for (const debt of computePairwiseDebts(e.payers, e.splits)) {
      bump(e.currency, debt.fromUserId, debt.toUserId, debt.amount);
    }
  }
  // A settlement from A to B pays down what A owed B.
  for (const s of settlements) {
    bump(s.currency, s.fromUserId, s.toUserId, -s.amount);
  }

  const out: PairwiseDebt[] = [];
  for (const [key, signed] of ledger) {
    if (signed === 0) continue;
    const [currency, low, high] = key.split('|') as [string, string, string];
    out.push(
      signed > 0
        ? { currency, fromUserId: low, toUserId: high, amount: signed }
        : { currency, fromUserId: high, toUserId: low, amount: -signed },
    );
  }
  out.sort((a, b) =>
    a.currency.localeCompare(b.currency) ||
    a.fromUserId.localeCompare(b.fromUserId) ||
    a.toUserId.localeCompare(b.toUserId),
  );
  return out;
}

export interface SettlementSuggestion extends Transfer {
  currency: string;
}

/** Minimal set of transfers that settles the whole group, per currency. */
export function suggestSettlements(nets: NetsByCurrency): SettlementSuggestion[] {
  const out: SettlementSuggestion[] = [];
  const currencies = [...nets.keys()].sort();
  for (const currency of currencies) {
    const perUser = nets.get(currency)!;
    const list = [...perUser.entries()]
      .map(([userId, amount]) => ({ userId, amount }))
      .filter((n) => n.amount !== 0);
    for (const t of simplifyDebts(list)) {
      out.push({ ...t, currency });
    }
  }
  return out;
}

/** Flatten a user's nets across currencies into a list (dropping zeros). */
export function netsForUser(nets: NetsByCurrency, userId: string): CurrencyAmount[] {
  const out: CurrencyAmount[] = [];
  for (const [currency, perUser] of nets) {
    const amount = perUser.get(userId) ?? 0;
    if (amount !== 0) out.push({ currency, amount });
  }
  out.sort((a, b) => a.currency.localeCompare(b.currency));
  return out;
}
