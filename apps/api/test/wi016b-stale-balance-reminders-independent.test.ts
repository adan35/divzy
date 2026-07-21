// Test-stage independent verification of WI-016b — settlements' own slice of
// stale-balance reminders (scheduler, staleness computation, cooldown model).
// Written from story-WI-016.md's "Opt-in stale-balance reminders" Gherkin
// feature and spec-WI-016.md §"Part A" / ADR-018, deliberately BEFORE reading
// the build's own test file line-by-line for scenario ideas, to avoid simply
// re-deriving the developer's own test list. Adds cases the build's own suite
// (test/stale-balance-reminders-job.test.ts) does not cover:
//   - opt-in is evaluated per RECIPIENT, not per pair (an opted-out debtor's
//     opted-in creditor still gets reminded "X owes you...")
//   - determinism under a fixed `now` (ADR-018's explicit testability requirement)
//   - cross-context ledger query has no groupId filter (bilateral, never scoped
//     to one group)
//   - new *partial* activity (not a full settle) still resets the staleness
//     clock, without zeroing the debt
//   - a debt that nets to zero via multiple records (not just one offsetting
//     settlement) still correctly produces no candidate
//   - zero-decimal currency (JPY) formats correctly in the reminder body
//   - a stronger per-user isolation test: the surviving user's specific
//     candidate and notification content are asserted, not just call counts

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

const USER_A = 'user_aaaaaaaa'; // opted in, in most scenarios
const USER_B = 'user_bbbbbbbb'; // counterparty, opt-in status varies per test

const NOW = new Date('2026-07-16T09:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);

function expenseBetween(payerId: string, splitId: string, opts: { amount?: number; currency?: string; createdAt: Date }) {
  const amount = opts.amount ?? 5000;
  return {
    currency: opts.currency ?? 'USD',
    createdAt: opts.createdAt,
    payers: [{ userId: payerId, amount }],
    splits: [{ userId: splitId, amount }],
  };
}

function settlementBetween(fromId: string, toId: string, opts: { amount: number; currency?: string; createdAt: Date }) {
  return {
    currency: opts.currency ?? 'USD',
    fromUserId: fromId,
    toUserId: toId,
    amount: opts.amount,
    createdAt: opts.createdAt,
  };
}

/** Routes the two distinct `user.findMany` call shapes: opted-in scan vs. name lookup. */
function mockUsers(optedIn: string[], names: Record<string, string> = {}) {
  userFindManyMock.mockImplementation((args: { where?: Record<string, unknown> }) => {
    const where = args?.where ?? {};
    if ('staleBalanceRemindersEnabled' in where) {
      return Promise.resolve(optedIn.map((id) => ({ id })));
    }
    const idIn = (where.id as { in?: string[] } | undefined)?.in ?? [];
    return Promise.resolve(idIn.map((id) => ({ id, name: names[id] ?? id })));
  });
}

beforeEach(() => {
  userFindManyMock.mockReset();
  expenseFindManyMock.mockReset().mockResolvedValue([]);
  settlementFindManyMock.mockReset().mockResolvedValue([]);
  staleBalanceReminderFindManyMock.mockReset().mockResolvedValue([]);
  staleBalanceReminderUpsertMock.mockReset().mockResolvedValue({});
  sendSystemNotificationMock.mockReset().mockResolvedValue(undefined);
});

describe('WI-016b independent verification — opt-in gate is per recipient, not per pair', () => {
  it('an opted-in creditor is still reminded about a stale debt owed by an opted-OUT debtor', async () => {
    // Only B is opted in; A (the debtor) is not. The scan is driven entirely by
    // who is opted in (B), and B's own cross-context ledger query naturally
    // includes the A<->B expense because B is a party to it.
    mockUsers([USER_B], { [USER_A]: 'Ana' });
    expenseFindManyMock.mockResolvedValue([
      expenseBetween(USER_B, USER_A, { createdAt: daysAgo(STALE_AFTER_DAYS + 1) }),
    ]);

    const result = await findStaleReminderCandidates(NOW);

    expect(result).toEqual([
      { userId: USER_B, counterpartyId: USER_A, currency: 'USD', amount: 5000, direction: 'owed' },
    ]);
    expect(sendSystemNotificationMock).toHaveBeenCalledTimes(1);
    const [call] = sendSystemNotificationMock.mock.calls[0] as [Record<string, unknown>];
    expect(call.userId).toBe(USER_B);
    expect(call.body).toBe('Ana owes you 50.00 USD');
  });

  it('the opted-out debtor never receives a reminder for the same debt', async () => {
    // A is not opted in at all -> the scan query for opted-in users never
    // returns A, so scanUser(A, ...) never runs and A can never be a `userId`
    // on any produced candidate, regardless of what B's scan finds.
    mockUsers([USER_B]);
    expenseFindManyMock.mockResolvedValue([
      expenseBetween(USER_B, USER_A, { createdAt: daysAgo(STALE_AFTER_DAYS + 1) }),
    ]);

    const result = await findStaleReminderCandidates(NOW);

    expect(result.some((c) => c.userId === USER_A)).toBe(false);
  });
});

describe('WI-016b independent verification — determinism (ADR-018 testability requirement)', () => {
  it('produces byte-identical output across two calls given the same fixed `now` and same ledger state', async () => {
    mockUsers([USER_A], { [USER_B]: 'Bailey' });
    expenseFindManyMock.mockResolvedValue([
      expenseBetween(USER_B, USER_A, { createdAt: daysAgo(STALE_AFTER_DAYS + 5) }),
    ]);

    const first = await findStaleReminderCandidates(NOW);
    const second = await findStaleReminderCandidates(NOW);

    expect(second).toEqual(first);
    expect(first).toEqual([
      { userId: USER_A, counterpartyId: USER_B, currency: 'USD', amount: 5000, direction: 'owe' },
    ]);
  });

  it('is a pure function of its `now` argument — no reliance on a live system clock or timer', async () => {
    // Passing an explicit `now` far in the future relative to activity makes the
    // same fixture stale; passing a `now` close to the activity makes it fresh.
    // Both are driven purely by the argument, proving no hidden dependency on
    // Date.now()/timers inside the pure scan path.
    mockUsers([USER_A]);
    const activityAt = new Date('2026-01-01T00:00:00.000Z');
    expenseFindManyMock.mockResolvedValue([expenseBetween(USER_B, USER_A, { createdAt: activityAt })]);

    const freshResult = await findStaleReminderCandidates(new Date(activityAt.getTime() + 1 * DAY_MS));
    expect(freshResult).toEqual([]);

    const staleResult = await findStaleReminderCandidates(
      new Date(activityAt.getTime() + (STALE_AFTER_DAYS + 1) * DAY_MS),
    );
    expect(staleResult).toHaveLength(1);
  });
});

describe('WI-016b independent verification — cross-context ledger (bilateral, never group-scoped)', () => {
  it("queries a user's full ledger without any groupId filter", async () => {
    mockUsers([USER_A]);
    expenseFindManyMock.mockResolvedValue([
      expenseBetween(USER_B, USER_A, { createdAt: daysAgo(STALE_AFTER_DAYS + 1) }),
    ]);

    await findStaleReminderCandidates(NOW);

    expect(expenseFindManyMock).toHaveBeenCalledTimes(1);
    const [{ where }] = expenseFindManyMock.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(where).not.toHaveProperty('groupId');
    expect(settlementFindManyMock).toHaveBeenCalledTimes(1);
    const [{ where: settlementWhere }] = settlementFindManyMock.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(settlementWhere).not.toHaveProperty('groupId');
  });
});

describe('WI-016b independent verification — new activity resets staleness (partial payment case)', () => {
  it('a recent partial-payment settlement resets staleness even though the debt remains non-zero', async () => {
    mockUsers([USER_A]);
    // Old expense: B paid 100.00, A owes it all. Recent partial settlement: A
    // pays B back 20.00 two days ago -> debt is still non-zero (80.00 owed) but
    // the settlement is the pair's most recent USD activity.
    expenseFindManyMock.mockResolvedValue([
      expenseBetween(USER_B, USER_A, { amount: 10000, createdAt: daysAgo(STALE_AFTER_DAYS + 30) }),
    ]);
    settlementFindManyMock.mockResolvedValue([
      settlementBetween(USER_A, USER_B, { amount: 2000, createdAt: daysAgo(2) }),
    ]);

    const result = await findStaleReminderCandidates(NOW);

    expect(result).toEqual([]);
    expect(sendSystemNotificationMock).not.toHaveBeenCalled();
  });

  it('once that recent partial payment itself ages past 14 days with no further activity, the (still non-zero) debt becomes a candidate again', async () => {
    mockUsers([USER_A], { [USER_B]: 'Bailey' });
    expenseFindManyMock.mockResolvedValue([
      expenseBetween(USER_B, USER_A, { amount: 10000, createdAt: daysAgo(60) }),
    ]);
    settlementFindManyMock.mockResolvedValue([
      settlementBetween(USER_A, USER_B, { amount: 2000, createdAt: daysAgo(STALE_AFTER_DAYS + 1) }),
    ]);

    const result = await findStaleReminderCandidates(NOW);

    expect(result).toEqual([
      { userId: USER_A, counterpartyId: USER_B, currency: 'USD', amount: 8000, direction: 'owe' },
    ]);
  });
});

describe('WI-016b independent verification — zero-sum via multiple records never reminds', () => {
  it('a debt that nets to exactly zero across two expenses and one settlement produces no candidate', async () => {
    mockUsers([USER_A]);
    const old = daysAgo(STALE_AFTER_DAYS + 20);
    expenseFindManyMock.mockResolvedValue([
      expenseBetween(USER_B, USER_A, { amount: 3000, createdAt: old }), // A owes B 30.00
      expenseBetween(USER_A, USER_B, { amount: 1000, createdAt: old }), // B owes A 10.00 -> net A owes B 20.00
    ]);
    settlementFindManyMock.mockResolvedValue([
      settlementBetween(USER_A, USER_B, { amount: 2000, createdAt: old }), // A pays B 20.00 -> net zero
    ]);

    const result = await findStaleReminderCandidates(NOW);

    expect(result).toEqual([]);
    expect(sendSystemNotificationMock).not.toHaveBeenCalled();
  });
});

describe('WI-016b independent verification — zero-decimal currency formatting', () => {
  it('formats a JPY (0-decimal) reminder body without a decimal point', async () => {
    mockUsers([USER_A], { [USER_B]: 'Bailey' });
    expenseFindManyMock.mockResolvedValue([
      expenseBetween(USER_B, USER_A, { amount: 5000, currency: 'JPY', createdAt: daysAgo(STALE_AFTER_DAYS + 1) }),
    ]);

    await findStaleReminderCandidates(NOW);

    const [call] = sendSystemNotificationMock.mock.calls[0] as [Record<string, unknown>];
    expect(call.body).toBe('You owe Bailey 5000 JPY');
  });
});

describe('WI-016b independent verification — per-user isolation under failure (stronger than call-count only)', () => {
  it('a failure scanning one opted-in user does not suppress or corrupt the next opted-in user’s real candidate', async () => {
    const USER_C = 'user_cccccccc';
    mockUsers([USER_A, USER_C], { [USER_B]: 'Bailey' });

    // A's settlement query throws; C's succeeds with a genuine stale candidate.
    settlementFindManyMock.mockImplementation((args: { where: { OR: Array<{ fromUserId?: string }> } }) => {
      const userId = args.where.OR[0].fromUserId;
      if (userId === USER_A) throw new Error('db timeout for A');
      return Promise.resolve([]);
    });
    expenseFindManyMock.mockImplementation((args: { where: { OR: Array<{ payers?: { some: { userId: string } } }> } }) => {
      const userId = args.where.OR[0].payers!.some.userId;
      if (userId === USER_A) return Promise.resolve([]); // unreached once settlement query throws first anyway
      return Promise.resolve([expenseBetween(USER_B, USER_C, { createdAt: daysAgo(STALE_AFTER_DAYS + 1) })]);
    });

    const result = await findStaleReminderCandidates(NOW);

    expect(result).toEqual([
      { userId: USER_C, counterpartyId: USER_B, currency: 'USD', amount: 5000, direction: 'owe' },
    ]);
    expect(sendSystemNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendSystemNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_C, type: 'BALANCE_REMINDER' }),
    );
  });
});

describe('WI-016b independent verification — cooldown boundary is a half-open [0, 7) window', () => {
  it('exactly 7.0 days since the last reminder is treated as eligible again (>= cooldown, not >)', async () => {
    mockUsers([USER_A]);
    expenseFindManyMock.mockResolvedValue([
      expenseBetween(USER_B, USER_A, { createdAt: daysAgo(STALE_AFTER_DAYS + 10) }),
    ]);
    staleBalanceReminderFindManyMock.mockResolvedValue([
      {
        id: 'rem_1',
        userId: USER_A,
        counterpartyId: USER_B,
        currency: 'USD',
        lastRemindedAt: new Date(NOW.getTime() - REMINDER_COOLDOWN_DAYS * DAY_MS),
      },
    ]);

    const result = await findStaleReminderCandidates(NOW);

    expect(result).toHaveLength(1);
  });
});
