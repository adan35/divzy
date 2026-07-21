// spec-WI-071.md §2 / story-WI-071.md's "stale-balance-reminders job gains
// bounded cross-user concurrency" feature — the WI-071-specific additions on
// top of the already-extensive pre-existing coverage in
// test/stale-balance-reminders-job.test.ts and
// test/wi016b-stale-balance-reminders-independent.test.ts (which this file
// does not re-derive): the chunked-concurrency behavior itself.
//
// Covers:
//  1. The exact same candidate SET is found for a population spanning
//     multiple chunks (12 users, REMINDER_SCAN_CONCURRENCY = 8 -> 2 chunks)
//     as a strictly-sequential scan would find.
//  2. A >14-day-stale debt is still found — the per-user scan itself remains
//     fully unbounded by any date window; only the cross-user loop changed.
//  3. Timing proof the batch is neither fully sequential (peak concurrency
//     must exceed 1) nor one giant unbounded Promise.all over the whole
//     population (peak concurrency must stay well under the population
//     size, in the story's "5-10 concurrently" band).
//  4. One user's scanUser failure inside one chunk never drops another
//     chunk's candidates.
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

import { findStaleReminderCandidates, STALE_AFTER_DAYS } from '../src/jobs/stale-balance-reminders';

const NOW = new Date('2026-07-20T09:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);

/** userId string long enough to look real; zId-shaped but irrelevant here (no HTTP layer involved). */
function userId(label: string): string {
  return `user_${label}_00000000`.slice(0, 24);
}

/** counterparty owes `who` `amount` in `currency`, stale by construction. */
function staleExpense(who: string, counterparty: string, amount: number, currency = 'USD') {
  return {
    currency,
    createdAt: daysAgo(STALE_AFTER_DAYS + 5),
    payers: [{ userId: who, amount }],
    splits: [{ userId: counterparty, amount }],
  };
}

/** Routes the two distinct `user.findMany` call shapes: opted-in scan vs. name lookup. */
function mockOptedInUsers(ids: string[]) {
  userFindManyMock.mockImplementation((args: { where?: Record<string, unknown> }) => {
    const where = args?.where ?? {};
    if ('staleBalanceRemindersEnabled' in where) {
      return Promise.resolve(ids.map((id) => ({ id })));
    }
    const idIn = (where.id as { in?: string[] } | undefined)?.in ?? [];
    return Promise.resolve(idIn.map((id) => ({ id, name: id })));
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

describe('WI-071 §2 — candidate set is identical across a multi-chunk population', () => {
  it('finds every one of 12 opted-in users\' stale candidates (2 chunks of REMINDER_SCAN_CONCURRENCY=8), regardless of batching', async () => {
    const counterparty = userId('counterparty');
    const users = Array.from({ length: 12 }, (_, i) => userId(`u${i}`));
    mockOptedInUsers(users);

    // Give each of the 12 users their OWN distinct amount so a mixed-up/dropped
    // candidate would be individually detectable, not just a count match.
    expenseFindManyMock.mockImplementation((args: { where: { OR: Array<{ payers?: { some: { userId: string } } }> } }) => {
      const who = args.where.OR[0].payers!.some.userId;
      const index = users.indexOf(who);
      if (index === -1) return Promise.resolve([]);
      return Promise.resolve([staleExpense(who, counterparty, 1000 + index)]);
    });

    const result = await findStaleReminderCandidates(NOW);

    expect(result).toHaveLength(12);
    for (let i = 0; i < users.length; i += 1) {
      expect(result).toContainEqual({
        userId: users[i],
        counterpartyId: counterparty,
        currency: 'USD',
        amount: 1000 + i,
        direction: 'owed',
      });
    }
  });

  it('the per-user scan remains fully unbounded by any date window under batching (a >>14-day-stale debt is still found)', async () => {
    const users = [userId('lonely')];
    mockOptedInUsers(users);
    const counterparty = userId('cp');
    // Far older than the 14-day threshold, with no other activity since.
    expenseFindManyMock.mockResolvedValue([staleExpense(users[0]!, counterparty, 4200)].map((e) => ({
      ...e,
      createdAt: daysAgo(200),
    })));

    const result = await findStaleReminderCandidates(NOW);

    expect(result).toEqual([
      { userId: users[0], counterpartyId: counterparty, currency: 'USD', amount: 4200, direction: 'owed' },
    ]);
  });
});

describe('WI-071 §2 — bounded concurrency: neither sequential nor one unbounded Promise.all', () => {
  it('scans users with real overlap (peak > 1) but never more than the story\'s ~5-10 band, across 16 users (2 full chunks)', async () => {
    const users = Array.from({ length: 16 }, (_, i) => userId(`conc${i}`));
    mockOptedInUsers(users);

    let inFlight = 0;
    let maxInFlight = 0;
    expenseFindManyMock.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return [];
    });

    await findStaleReminderCandidates(NOW);

    // Not sequential: overlapping expense.findMany calls actually observed.
    expect(maxInFlight).toBeGreaterThan(1);
    // Not one giant Promise.all over the whole population (16 users):
    // peak concurrency must stay well under the population size, in the
    // story's own "on the order of 5-10 concurrently per batch" band.
    expect(maxInFlight).toBeLessThanOrEqual(10);
    expect(maxInFlight).toBeLessThan(users.length);
  });
});

describe('WI-071 §2 — one user\'s scan failure never drops another CHUNK\'s candidates', () => {
  it('a throw in chunk 1 (users 0-7) does not suppress a real candidate in chunk 2 (users 8-9)', async () => {
    const users = Array.from({ length: 10 }, (_, i) => userId(`chunk${i}`));
    mockOptedInUsers(users);
    const counterparty = userId('cp2');
    const failer = users[3]!; // inside the first chunk (indices 0-7)
    const survivor = users[9]!; // inside the second chunk (indices 8-9)

    expenseFindManyMock.mockImplementation((args: { where: { OR: Array<{ payers?: { some: { userId: string } } }> } }) => {
      const who = args.where.OR[0].payers!.some.userId;
      if (who === failer) throw new Error('transient db error for chunk-1 user');
      if (who === survivor) return Promise.resolve([staleExpense(survivor, counterparty, 777)]);
      return Promise.resolve([]);
    });

    const result = await findStaleReminderCandidates(NOW);

    expect(result).toEqual([
      { userId: survivor, counterpartyId: counterparty, currency: 'USD', amount: 777, direction: 'owed' },
    ]);
  });
});
