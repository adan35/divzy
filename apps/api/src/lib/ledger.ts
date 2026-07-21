import { prisma } from './prisma';

/**
 * Ledger inputs for the shared balance engine (`computeNets`/`computePairwiseBalances`):
 * one group's own expenses + settlements, soft-deletes excluded (ARCH invariant 6).
 *
 * Extracted from `routes/balances.ts` (WI-012) so `routes/settlements.ts`'s new
 * balance-bound check reuses the exact same query shape instead of duplicating it.
 */
export async function loadGroupLedger(groupId: string) {
  const [expenses, settlements] = await Promise.all([
    prisma.expense.findMany({
      where: { groupId, deletedAt: null },
      select: {
        currency: true,
        payers: { select: { userId: true, amount: true } },
        splits: { select: { userId: true, amount: true } },
      },
    }),
    prisma.settlement.findMany({
      where: { groupId, deletedAt: null },
      select: { currency: true, fromUserId: true, toUserId: true, amount: true },
    }),
  ]);
  return { expenses, settlements };
}
