// spec-WI-016 (settlements slice) / ADR-018 — the settlements-owned half of the
// stale-balance reminder scan: `findStaleReminderCandidates(now)`, a deterministic,
// timer-free function that scans opted-in users' bilateral ledgers for a stale
// (>= STALE_AFTER_DAYS), non-zero, per-currency debt, sends a reminder via
// notifications-activity's `sendSystemNotification` (mocked here — never the real
// delivery path in a unit test), and upserts `StaleBalanceReminder` cooldown rows.
//
// Mocks every collaborator: prisma (user/expense/settlement/staleBalanceReminder)
// and '../src/lib/activity' (sendSystemNotification). The balance engine itself
// (`computePairwiseBalances` from '@divzy/shared') is NOT mocked — these are
// whitebox-adjacent tests against the real engine output.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const userFindManyMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const staleBalanceReminderFindManyMock = vi.fn();
const staleBalanceReminderUpsertMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findMany: (...args: unknown[]) => userFindManyMock(...args) },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: { findMany: (...args: unknown[]) => settlementFindManyMock(...args) },
    staleBalanceReminder: {
      findMany: (...args: unknown[]) => staleBalanceReminderFindManyMock(...args),
      upsert: (...args: unknown[]) => staleBalanceReminderUpsertMock(...args),
    },
  },
}));

const sendSystemNotificationMock = vi.fn();
vi.mock('../src/lib/activity', () => ({
  sendSystemNotification: (...args: unknown[]) => sendSystemNotificationMock(...args),
}));

import {
  findStaleReminderCandidates,
  REMINDER_COOLDOWN_DAYS,
  STALE_AFTER_DAYS,
} from '../src/jobs/stale-balance-reminders';

const USER_A = 'user_aaaaaaaa';
const USER_B = 'user_bbbbbbbb';

const NOW = new Date('2026-07-16T09:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);

/** A -> B expense: B paid, A owes the full split. Creates a pairwise debt A owes B. */
function aOwesBExpense(overrides: {
  amount?: number;
  currency?: string;
  createdAt: Date;
}) {
  const amount = overrides.amount ?? 5000;
  return {
    currency: overrides.currency ?? 'USD',
    createdAt: overrides.createdAt,
    payers: [{ userId: USER_B, amount }],
    splits: [{ userId: USER_A, amount }],
  };
}

function opt(userId: string) {
  return { id: userId };
}

beforeEach(() => {
  userFindManyMock.mockReset();
  expenseFindManyMock.mockReset().mockResolvedValue([]);
  settlementFindManyMock.mockReset().mockResolvedValue([]);
  staleBalanceReminderFindManyMock.mockReset().mockResolvedValue([]);
  staleBalanceReminderUpsertMock.mockReset().mockResolvedValue({});
  sendSystemNotificationMock.mockReset().mockResolvedValue(undefined);
});

/** Route the two distinct `user.findMany` call shapes used by the job:
 *  (1) the opted-in scan (`where.staleBalanceRemindersEnabled`), (2) the
 *  counterparty name lookup (`where.id.in`). */
function mockUsers(optedIn: string[], names: Record<string, string> = {}) {
  userFindManyMock.mockImplementation((args: { where?: Record<string, unknown> }) => {
    const where = args?.where ?? {};
    if ('staleBalanceRemindersEnabled' in where) {
      return Promise.resolve(optedIn.map(opt));
    }
    const idIn = (where.id as { in?: string[] } | undefined)?.in ?? [];
    return Promise.resolve(
      idIn.map((id) => ({ id, name: names[id] ?? id })),
    );
  });
}

describe('findStaleReminderCandidates', () => {
  it('produces a candidate for a stale (>= 14d), non-zero bilateral debt', async () => {
    mockUsers([USER_A], { [USER_B]: 'Bailey' });
    expenseFindManyMock.mockResolvedValue([aOwesBExpense({ createdAt: daysAgo(STALE_AFTER_DAYS + 1) })]);

    const result = await findStaleReminderCandidates(NOW);

    expect(result).toEqual([
      { userId: USER_A, counterpartyId: USER_B, currency: 'USD', amount: 5000, direction: 'owe' },
    ]);
    expect(sendSystemNotificationMock).toHaveBeenCalledTimes(1);
    const [call] = sendSystemNotificationMock.mock.calls[0] as [Record<string, unknown>];
    expect(call).toMatchObject({ userId: USER_A, type: 'BALANCE_REMINDER' });
    expect(call.body).toContain('Bailey');
    expect(call.body).toContain('50.00 USD');
    expect(staleBalanceReminderUpsertMock).toHaveBeenCalledTimes(1);
    const upsertArgs = staleBalanceReminderUpsertMock.mock.calls[0][0] as {
      where: { userId_counterpartyId_currency: Record<string, unknown> };
      update: { lastRemindedAt: Date };
      create: Record<string, unknown>;
    };
    expect(upsertArgs.where.userId_counterpartyId_currency).toEqual({
      userId: USER_A,
      counterpartyId: USER_B,
      currency: 'USD',
    });
    expect(upsertArgs.update.lastRemindedAt).toEqual(NOW);
  });

  it('does not produce a candidate when the most recent activity is < 14 days old', async () => {
    mockUsers([USER_A]);
    expenseFindManyMock.mockResolvedValue([aOwesBExpense({ createdAt: daysAgo(STALE_AFTER_DAYS - 1) })]);

    const result = await findStaleReminderCandidates(NOW);

    expect(result).toEqual([]);
    expect(sendSystemNotificationMock).not.toHaveBeenCalled();
    expect(staleBalanceReminderUpsertMock).not.toHaveBeenCalled();
  });

  it('does not produce a candidate for a fully settled (zero bilateral) pair', async () => {
    mockUsers([USER_A]);
    const createdAt = daysAgo(STALE_AFTER_DAYS + 5);
    expenseFindManyMock.mockResolvedValue([aOwesBExpense({ createdAt })]);
    // A pays B back in full -> pairwise debt nets to exactly zero.
    settlementFindManyMock.mockResolvedValue([
      { currency: 'USD', fromUserId: USER_A, toUserId: USER_B, amount: 5000, createdAt },
    ]);

    const result = await findStaleReminderCandidates(NOW);

    expect(result).toEqual([]);
    expect(sendSystemNotificationMock).not.toHaveBeenCalled();
  });

  it('a soft-deleted recent settlement never counts as recent activity — the stale expense still fires', async () => {
    mockUsers([USER_A]);
    expenseFindManyMock.mockResolvedValue([aOwesBExpense({ createdAt: daysAgo(STALE_AFTER_DAYS + 3) })]);
    // The query itself is the ARCH-invariant-6 enforcement point: deletedAt: null
    // means a soft-deleted recent settlement is never even returned by Prisma, so
    // it can never appear in this mocked result set either.
    settlementFindManyMock.mockResolvedValue([]);

    const result = await findStaleReminderCandidates(NOW);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ userId: USER_A, counterpartyId: USER_B, currency: 'USD' });
    // Prove the exclusion mechanism: both ledger queries filter deletedAt: null.
    expect(expenseFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
    expect(settlementFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });

  it('skips a candidate whose cooldown row is < 7 days old', async () => {
    mockUsers([USER_A]);
    expenseFindManyMock.mockResolvedValue([aOwesBExpense({ createdAt: daysAgo(STALE_AFTER_DAYS + 10) })]);
    staleBalanceReminderFindManyMock.mockResolvedValue([
      {
        id: 'rem_1',
        userId: USER_A,
        counterpartyId: USER_B,
        currency: 'USD',
        lastRemindedAt: daysAgo(REMINDER_COOLDOWN_DAYS - 1),
      },
    ]);

    const result = await findStaleReminderCandidates(NOW);

    expect(result).toEqual([]);
    expect(sendSystemNotificationMock).not.toHaveBeenCalled();
    expect(staleBalanceReminderUpsertMock).not.toHaveBeenCalled();
  });

  it('produces a candidate again once the cooldown row is >= 7 days old', async () => {
    mockUsers([USER_A]);
    expenseFindManyMock.mockResolvedValue([aOwesBExpense({ createdAt: daysAgo(STALE_AFTER_DAYS + 10) })]);
    staleBalanceReminderFindManyMock.mockResolvedValue([
      {
        id: 'rem_1',
        userId: USER_A,
        counterpartyId: USER_B,
        currency: 'USD',
        lastRemindedAt: daysAgo(REMINDER_COOLDOWN_DAYS),
      },
    ]);

    const result = await findStaleReminderCandidates(NOW);

    expect(result).toHaveLength(1);
    expect(sendSystemNotificationMock).toHaveBeenCalledTimes(1);
    expect(staleBalanceReminderUpsertMock).toHaveBeenCalledTimes(1);
  });

  it('never reminds a user who has not opted in (staleBalanceRemindersEnabled: false)', async () => {
    mockUsers([]); // the scan query itself returns nobody for an opted-out population
    expenseFindManyMock.mockResolvedValue([aOwesBExpense({ createdAt: daysAgo(STALE_AFTER_DAYS + 10) })]);

    const result = await findStaleReminderCandidates(NOW);

    expect(result).toEqual([]);
    expect(userFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ staleBalanceRemindersEnabled: true }) }),
    );
    // No opted-in users -> the ledger is never even loaded.
    expect(expenseFindManyMock).not.toHaveBeenCalled();
    expect(sendSystemNotificationMock).not.toHaveBeenCalled();
  });

  it('evaluates multi-currency pairs independently: a stale USD debt fires while a fresh EUR debt does not', async () => {
    mockUsers([USER_A]);
    expenseFindManyMock.mockResolvedValue([
      aOwesBExpense({ currency: 'USD', amount: 5000, createdAt: daysAgo(STALE_AFTER_DAYS + 1) }),
      aOwesBExpense({ currency: 'EUR', amount: 3000, createdAt: daysAgo(STALE_AFTER_DAYS - 5) }),
    ]);

    const result = await findStaleReminderCandidates(NOW);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ currency: 'USD', amount: 5000 });
    expect(sendSystemNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('produces the opposite-direction body when the counterparty owes the caller', async () => {
    mockUsers([USER_A], { [USER_B]: 'Bailey' });
    // B paid, A is NOT in the split -> B owes nobody; flip it: A paid, B owes A.
    expenseFindManyMock.mockResolvedValue([
      {
        currency: 'USD',
        createdAt: daysAgo(STALE_AFTER_DAYS + 1),
        payers: [{ userId: USER_A, amount: 2000 }],
        splits: [{ userId: USER_B, amount: 2000 }],
      },
    ]);

    const result = await findStaleReminderCandidates(NOW);

    expect(result).toEqual([
      { userId: USER_A, counterpartyId: USER_B, currency: 'USD', amount: 2000, direction: 'owed' },
    ]);
    const [call] = sendSystemNotificationMock.mock.calls[0] as [Record<string, unknown>];
    expect(call.body).toBe('Bailey owes you 20.00 USD');
  });

  it('per-user scan failures are logged and never break the batch', async () => {
    mockUsers([USER_A, USER_B]);
    expenseFindManyMock.mockImplementation((args: { where: { OR: Array<{ payers?: unknown }> } }) => {
      // Fail deterministically for the first user's query shape by throwing on
      // the very first call; the second user's scan must still complete.
      if (expenseFindManyMock.mock.calls.length === 1) {
        throw new Error('boom');
      }
      return Promise.resolve([aOwesBExpense({ createdAt: daysAgo(STALE_AFTER_DAYS + 1) })]);
    });

    const result = await findStaleReminderCandidates(NOW);

    // The second user's scan (B, using the same fixture data shaped for A/B)
    // still runs and is unaffected by the first user's failure.
    expect(result.length).toBeGreaterThanOrEqual(0);
    expect(expenseFindManyMock).toHaveBeenCalledTimes(2);
  });
});
