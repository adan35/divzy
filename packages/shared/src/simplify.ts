export interface NetBalance {
  userId: string;
  /** Positive = is owed money (creditor); negative = owes money (debtor). Minor units. */
  amount: number;
}

export interface Transfer {
  fromUserId: string;
  toUserId: string;
  amount: number;
}

/**
 * Turn a zero-sum set of net balances into a small set of transfers that
 * settles everyone (min cash flow, greedy largest-first matching).
 * Produces at most n-1 transfers. Deterministic: ties break on userId.
 */
export function simplifyDebts(nets: readonly NetBalance[]): Transfer[] {
  const total = nets.reduce((acc, n) => acc + n.amount, 0);
  if (total !== 0) {
    throw new Error(`simplifyDebts: net balances must sum to 0, got ${total}`);
  }

  const byLargest = (a: NetBalance, b: NetBalance) =>
    b.amount === a.amount ? a.userId.localeCompare(b.userId) : b.amount - a.amount;

  const creditors = nets
    .filter((n) => n.amount > 0)
    .map((n) => ({ ...n }))
    .sort(byLargest);
  const debtors = nets
    .filter((n) => n.amount < 0)
    .map((n) => ({ userId: n.userId, amount: -n.amount }))
    .sort(byLargest);

  const transfers: Transfer[] = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d]!;
    const creditor = creditors[c]!;
    const amount = Math.min(debtor.amount, creditor.amount);
    if (amount > 0) {
      transfers.push({ fromUserId: debtor.userId, toUserId: creditor.userId, amount });
    }
    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount === 0) d += 1;
    if (creditor.amount === 0) c += 1;
  }
  return transfers;
}
