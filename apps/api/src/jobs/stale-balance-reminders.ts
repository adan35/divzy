import cron from 'node-cron';
import { pino } from 'pino';
import { computePairwiseBalances, type LedgerExpense, type LedgerSettlement } from '@divzy/shared';
import { env } from '../config/env';
import { sendSystemNotification } from '../lib/activity';
import { decimalString } from '../lib/money-format';
import { prisma } from '../lib/prisma';

// spec-WI-016 §A / ADR-018 — opt-in, in-process daily scan of settlements' own
// bilateral balance engine, reminding a user about a non-zero pairwise debt
// (never the net/min-cash-flow view) that hasn't moved in a while. Modelled
// exactly on jobs/recurring.ts's `startRecurringJob` pattern.

const log = pino({
  name: 'stale-balance-reminders-job',
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
});

/** A reminder fires only once the pair's most recent activity is this old. */
export const STALE_AFTER_DAYS = 14;
/** Skip re-reminding about the same (user, counterparty, currency) inside this window. */
export const REMINDER_COOLDOWN_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Cap per run — the next day's run drains any backlog (mirrors recurring.ts's BATCH_SIZE). */
const USER_BATCH_SIZE = 200;

/**
 * WI-071 §2 — bounded cross-user concurrency for `findStaleReminderCandidates`.
 * Each `scanUser` opens with a `Promise.all` of 3 reads, so peak in-flight ≈
 * 8x3 = 24 queries — bounded, vs. the ~600-query stampede an unbounded
 * `Promise.all(200)` would issue at the 09:00 peak. Still ~8x wall-clock
 * improvement over the prior strictly-sequential loop. Retunable within the
 * story's 5-10 band without a spec change.
 */
const REMINDER_SCAN_CONCURRENCY = 8;

export type ReminderDirection = 'owe' | 'owed';

export interface StaleReminderCandidate {
  userId: string;
  counterpartyId: string;
  currency: string;
  /** Positive minor-unit amount of the bilateral debt in that currency (native, never converted — ARCH inv. 5). */
  amount: number;
  /** From `userId`'s perspective: 'owe' = userId owes counterpartyId, 'owed' = counterpartyId owes userId. */
  direction: ReminderDirection;
}

type LedgerExpenseRow = LedgerExpense & { createdAt: Date };
type LedgerSettlementRow = LedgerSettlement & { createdAt: Date };

/** True when `userId` has a real (amount > 0) stake in this expense, as payer or split. */
function hasStake(expense: LedgerExpenseRow, userId: string): boolean {
  return (
    expense.payers.some((p) => p.userId === userId && p.amount > 0) ||
    expense.splits.some((s) => s.userId === userId && s.amount > 0)
  );
}

/**
 * The most recent non-deleted expense (both parties have a stake) or settlement
 * between `userId` and `counterpartyId`, in `currency` only — currencies are
 * evaluated independently and never mixed, so a recent EUR expense must never
 * reset a stale USD debt between the same pair (ADR-018). `null` when there is
 * no such record (defensive — should not happen for a non-zero pairwise debt).
 */
function lastActivityAt(
  expenses: readonly LedgerExpenseRow[],
  settlements: readonly LedgerSettlementRow[],
  userId: string,
  counterpartyId: string,
  currency: string,
): Date | null {
  let latest: Date | null = null;
  const bump = (at: Date) => {
    if (!latest || at.getTime() > latest.getTime()) latest = at;
  };
  for (const e of expenses) {
    if (e.currency !== currency) continue;
    if (hasStake(e, userId) && hasStake(e, counterpartyId)) bump(e.createdAt);
  }
  for (const s of settlements) {
    if (s.currency !== currency) continue;
    const isPair =
      (s.fromUserId === userId && s.toUserId === counterpartyId) ||
      (s.fromUserId === counterpartyId && s.toUserId === userId);
    if (isPair) bump(s.createdAt);
  }
  return latest;
}

/** Minor-unit amount + currency code, e.g. "45.00 USD" — never a converted figure (ARCH inv. 5). */
function formatNative(amount: number, currency: string): string {
  return `${decimalString(amount, currency)} ${currency}`;
}

/**
 * Scan one opted-in user's full cross-context bilateral ledger, find every
 * stale, post-cooldown candidate, deliver a reminder for each via
 * notifications-activity's `sendSystemNotification`, and upsert the
 * `StaleBalanceReminder` cooldown row. Returns the candidates that were
 * actually reminded (post-cooldown filter).
 */
async function scanUser(userId: string, now: Date): Promise<StaleReminderCandidate[]> {
  const [expenses, settlements, cooldownRows] = await Promise.all([
    prisma.expense.findMany({
      where: {
        deletedAt: null,
        OR: [{ payers: { some: { userId } } }, { splits: { some: { userId } } }],
      },
      select: {
        currency: true,
        createdAt: true,
        payers: { select: { userId: true, amount: true } },
        splits: { select: { userId: true, amount: true } },
      },
    }),
    prisma.settlement.findMany({
      where: { deletedAt: null, OR: [{ fromUserId: userId }, { toUserId: userId }] },
      select: { currency: true, fromUserId: true, toUserId: true, amount: true, createdAt: true },
    }),
    prisma.staleBalanceReminder.findMany({ where: { userId } }),
  ]);

  // Bilateral, never net/min-cash-flow (ADR-018): computePairwiseBalances already
  // drops any pair whose signed balance is exactly zero — a fully settled pair
  // never appears here at all.
  const pairwise = computePairwiseBalances(expenses, settlements);
  const cooldownByKey = new Map(cooldownRows.map((r) => [`${r.counterpartyId}|${r.currency}`, r]));

  const stale: StaleReminderCandidate[] = [];
  for (const debt of pairwise) {
    if (debt.fromUserId !== userId && debt.toUserId !== userId) continue;
    const counterpartyId = debt.fromUserId === userId ? debt.toUserId : debt.fromUserId;
    const direction: ReminderDirection = debt.fromUserId === userId ? 'owe' : 'owed';

    const lastActivity = lastActivityAt(expenses, settlements, userId, counterpartyId, debt.currency);
    if (!lastActivity) continue;
    const ageDays = (now.getTime() - lastActivity.getTime()) / DAY_MS;
    if (ageDays < STALE_AFTER_DAYS) continue;

    const cooldown = cooldownByKey.get(`${counterpartyId}|${debt.currency}`);
    if (cooldown) {
      const cooldownAgeDays = (now.getTime() - cooldown.lastRemindedAt.getTime()) / DAY_MS;
      if (cooldownAgeDays < REMINDER_COOLDOWN_DAYS) continue;
    }

    stale.push({ userId, counterpartyId, currency: debt.currency, amount: debt.amount, direction });
  }

  if (stale.length === 0) return [];

  const counterpartyIds = [...new Set(stale.map((c) => c.counterpartyId))];
  const counterparties = await prisma.user.findMany({
    where: { id: { in: counterpartyIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(counterparties.map((u) => [u.id, u.name]));

  for (const candidate of stale) {
    const name = nameById.get(candidate.counterpartyId) ?? 'them';
    const formatted = formatNative(candidate.amount, candidate.currency);
    const body =
      candidate.direction === 'owe' ? `You owe ${name} ${formatted}` : `${name} owes you ${formatted}`;

    await sendSystemNotification({
      userId: candidate.userId,
      type: 'BALANCE_REMINDER',
      title: 'Stale balance reminder',
      body,
      data: {
        counterpartyId: candidate.counterpartyId,
        currency: candidate.currency,
        amount: candidate.amount,
        direction: candidate.direction,
      },
    });

    await prisma.staleBalanceReminder.upsert({
      where: {
        userId_counterpartyId_currency: {
          userId: candidate.userId,
          counterpartyId: candidate.counterpartyId,
          currency: candidate.currency,
        },
      },
      update: { lastRemindedAt: now },
      create: {
        userId: candidate.userId,
        counterpartyId: candidate.counterpartyId,
        currency: candidate.currency,
        lastRemindedAt: now,
      },
    });
  }

  return stale;
}

/**
 * Wraps `scanUser` so a rejected promise never sinks its chunk's
 * `Promise.all` (WI-071 §2). Preserves today's exact per-user log message and
 * behavior: a transient DB error on one user logs and skips that user, every
 * other user in the chunk and every other chunk still runs. Chosen over
 * `Promise.allSettled` to keep the existing log shape and a clean return type.
 */
async function scanUserSafe(userId: string, now: Date): Promise<StaleReminderCandidate[]> {
  try {
    return await scanUser(userId, now);
  } catch (err) {
    log.error({ err, userId }, 'Failed to scan user for stale balances');
    return [];
  }
}

/**
 * Scan every opted-in user (`staleBalanceRemindersEnabled: true`) for stale
 * bilateral balances, deliver reminders, and upsert cooldown bookkeeping.
 * Deterministic given a fixed `now` — exported for unit testing without the
 * scheduler (mirrors `jobs/recurring.ts`'s `processDueRecurring`). Per-user
 * failures are logged and never break the batch.
 *
 * WI-071 §2: users are scanned in fixed-size chunks (`REMINDER_SCAN_CONCURRENCY`)
 * processed concurrently via `Promise.all`, chunks themselves sequential.
 * `scanUser` itself is untouched — still an unbounded-per-user scan; only the
 * cross-user loop gains concurrency. The candidate result set is
 * order-independent, so this changes only wall-clock time, never the result.
 */
export async function findStaleReminderCandidates(now: Date = new Date()): Promise<StaleReminderCandidate[]> {
  const users = await prisma.user.findMany({
    where: { staleBalanceRemindersEnabled: true },
    select: { id: true },
    take: USER_BATCH_SIZE,
  });

  const results: StaleReminderCandidate[] = [];
  for (let i = 0; i < users.length; i += REMINDER_SCAN_CONCURRENCY) {
    const chunk = users.slice(i, i + REMINDER_SCAN_CONCURRENCY);
    const found = await Promise.all(chunk.map((u) => scanUserSafe(u.id, now)));
    results.push(...found.flat());
  }
  return results;
}

let running = false;

async function runOnce(): Promise<void> {
  if (running) return; // never overlap runs
  running = true;
  try {
    await findStaleReminderCandidates(new Date());
  } catch (err) {
    log.error({ err }, 'Stale balance reminders job run failed');
  } finally {
    running = false;
  }
}

let started = false;

/** Once daily at 09:00 + a post-boot catch-up ~10s after start (same pattern as
 *  jobs/recurring.ts's startRecurringJob, so restarts don't skip a day's scan). */
export function startStaleBalanceRemindersJob(): void {
  if (started) return;
  started = true;
  cron.schedule('0 9 * * *', () => {
    void runOnce();
  });
  setTimeout(() => {
    void runOnce();
  }, 10_000).unref();
}
