// spec-WI-067 §5 / story-WI-067.md User Stories 1, 3, 4 (API half) — GET
// /balance (15s) and GET /analytics/summary (60s) wrapped in `cached()`.
// Real-DB integration, mirroring this domain's established convention
// (wi054b-settlement-restore.test.ts / wi054-055-056-real-db-integration.test.ts):
// real users/expenses seeded via `prisma`, driven end-to-end through
// `app.inject` against the real routes.
//
// TDD: written directly from the spec/story BEFORE either route wrapped its
// body in `cached()` — red first. The core proof technique throughout: read
// once, mutate the underlying ledger DIRECTLY via prisma (bypassing every
// bump site on purpose, so nothing invalidates the cache), read again and
// assert the response is STILL the pre-mutation value (proves a real cache
// hit, not a coincidence), then call `bumpUserGeneration` directly (the
// mechanism every bump site relies on) and read once more to confirm the
// mutation is now visible. Bump-SITE correctness (are the right users bumped
// on each real mutation route) is covered separately in
// wi067-bump-sites.test.ts — this file only proves the read-through wrap
// itself.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../src/lib/prisma';
import { bumpUserGeneration } from '../src/lib/cache';
import { buildApp } from '../src/app';

const STAMP = Date.now();
let app: FastifyInstance;

const allUserIds: string[] = [];
const allGroupIds: string[] = [];
const allExpenseIds: string[] = [];

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `wi067-cache-${label}-${STAMP}@test.local`,
      passwordHash: 'not-a-real-hash',
      name: `WI-067 Cache ${label}`,
      emailNotifications: false,
    },
  });
  allUserIds.push(user.id);
  return user.id;
}

function tokenFor(userId: string) {
  return app.jwt.sign({ sub: userId });
}

/** Direct 2-person expense: `payer` pays the full amount, split evenly with `other`. */
async function createSplitExpense(
  payer: string,
  other: string,
  amountMinor: number,
  opts: { groupId?: string; category?: string } = {},
) {
  const half = Math.round(amountMinor / 2);
  const expense = await prisma.expense.create({
    data: {
      groupId: opts.groupId ?? null,
      description: 'WI-067 cache fixture expense',
      amount: amountMinor,
      currency: 'USD',
      category: (opts.category ?? 'OTHER') as never,
      date: new Date(),
      splitType: 'EQUAL',
      createdById: payer,
      payers: { createMany: { data: [{ userId: payer, amount: amountMinor }] } },
      splits: {
        createMany: {
          data: [
            { userId: payer, amount: amountMinor - half },
            { userId: other, amount: half },
          ],
        },
      },
    },
  });
  allExpenseIds.push(expense.id);
  return expense.id;
}

async function getBalance(userId: string) {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/balance',
    headers: { authorization: `Bearer ${tokenFor(userId)}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function getSummary(userId: string, query: Record<string, string> = {}) {
  const qs = new URLSearchParams(query).toString();
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/analytics/summary${qs ? `?${qs}` : ''}`,
    headers: { authorization: `Bearer ${tokenFor(userId)}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await prisma.expenseSplit.deleteMany({ where: { expenseId: { in: allExpenseIds } } });
  await prisma.expensePayer.deleteMany({ where: { expenseId: { in: allExpenseIds } } });
  await prisma.expense.deleteMany({ where: { id: { in: allExpenseIds } } });
  await prisma.groupMember.deleteMany({ where: { groupId: { in: allGroupIds } } });
  await prisma.group.deleteMany({ where: { id: { in: allGroupIds } } });
  await prisma.friendship.deleteMany({
    where: { OR: [{ userAId: { in: allUserIds } }, { userBId: { in: allUserIds } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: allUserIds } } });
  await app.close();
});

describe('GET /balance — cached() wrap (15s TTL)', () => {
  it('serves a stale hit until the caller generation is bumped, then recomputes fresh', async () => {
    const ana = await createUser('balance-ana');
    const sam = await createUser('balance-sam');
    await createSplitExpense(ana, sam, 1000); // sam owes ana 500

    const first = await getBalance(ana);
    expect(first.youAreOwed).toEqual([{ currency: 'USD', amount: 500 }]);

    // Mutate the underlying ledger DIRECTLY (no route, no bump site) — the
    // real balance is now 1000, but the cache doesn't know that yet.
    await createSplitExpense(ana, sam, 1000);

    const stillCached = await getBalance(ana);
    expect(stillCached).toEqual(first); // byte-for-byte identical — proves a real hit, no recompute

    bumpUserGeneration(ana);

    const fresh = await getBalance(ana);
    expect(fresh.youAreOwed).toEqual([{ currency: 'USD', amount: 1000 }]);
    expect(fresh).not.toEqual(first);
  });

  it('user isolation: bumping A never invalidates B, and B never sees A-scoped data', async () => {
    const ana = await createUser('isolation-ana');
    const sam = await createUser('isolation-sam');
    await createSplitExpense(ana, sam, 800); // sam owes ana 400

    const anaFirst = await getBalance(ana);
    const samFirst = await getBalance(sam);
    expect(anaFirst.youAreOwed).toEqual([{ currency: 'USD', amount: 400 }]);
    expect(samFirst.youOwe).toEqual([{ currency: 'USD', amount: 400 }]);

    await createSplitExpense(ana, sam, 800); // real balance is now 800 for both

    bumpUserGeneration(ana); // ONLY ana's generation advances

    const anaSecond = await getBalance(ana);
    expect(anaSecond.youAreOwed).toEqual([{ currency: 'USD', amount: 800 }]); // fresh

    const samSecond = await getBalance(sam);
    expect(samSecond).toEqual(samFirst); // sam's own cached entry, untouched by ana's bump
  });
});

describe('GET /analytics/summary — cached() wrap (60s TTL), query-param isolation', () => {
  it('scoped (groupId) and unscoped param sets cache independently, both bumped by the one shared generation', async () => {
    const user = await createUser('analytics-user');
    const other = await createUser('analytics-other');
    const group = await prisma.group.create({
      data: {
        name: 'WI-067 Cache Group',
        inviteCode: `wi067-cache-${STAMP}`,
        createdById: user,
        members: { create: [{ userId: user, role: 'ADMIN' }, { userId: other, role: 'MEMBER' }] },
      },
    });
    allGroupIds.push(group.id);

    await createSplitExpense(user, other, 1000, { groupId: group.id });

    const scopedFirst = await getSummary(user, { groupId: group.id });
    const unscopedFirst = await getSummary(user, {});
    expect(scopedFirst.totalActivity).toBeGreaterThan(0);
    expect(unscopedFirst.totalActivity).toBe(scopedFirst.totalActivity);

    // Mutate directly — grows both the group-scoped and unscoped totals once recomputed.
    await createSplitExpense(user, other, 1000, { groupId: group.id });

    const scopedStale = await getSummary(user, { groupId: group.id });
    const unscopedStale = await getSummary(user, {});
    expect(scopedStale).toEqual(scopedFirst); // still cached under its own key
    expect(unscopedStale).toEqual(unscopedFirst); // still cached under its own (different) key

    bumpUserGeneration(user); // one shared per-user generation invalidates BOTH entries

    const scopedFresh = await getSummary(user, { groupId: group.id });
    const unscopedFresh = await getSummary(user, {});
    expect(scopedFresh.totalActivity).toBe(scopedFirst.totalActivity * 2);
    expect(unscopedFresh.totalActivity).toBe(unscopedFirst.totalActivity * 2);
  });

  it('case-insensitive currency query does not split the cache (gap-closure §3.2)', async () => {
    const user = await createUser('analytics-case-user');
    const other = await createUser('analytics-case-other');
    await createSplitExpense(user, other, 1000);

    const lower = await getSummary(user, { currency: 'usd' });
    const upper = await getSummary(user, { currency: 'USD' });
    expect(lower).toEqual(upper);

    // Confirm it's a genuine cache hit (not just coincidentally-equal output):
    // mutate directly, then re-request lowercase — must still be the stale value.
    await createSplitExpense(user, other, 1000);
    const lowerAgain = await getSummary(user, { currency: 'usd' });
    expect(lowerAgain).toEqual(lower);
  });
});
