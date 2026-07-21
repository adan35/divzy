// spec-WI-078.md §4 / ADR-031's own cross-domain reuse contract — expenses'
// 4 write sites (createExpense/updateExpense/deleteExpense/restoreExpense)
// now each call `if (groupId) bumpGroupGeneration(groupId)` right after their
// existing `bumpUsers(...)` call, closing the exact gap WI-071 documented for
// settlements: an uninvolved active group member's cached
// `GET /groups/:groupId/balances` view previously stayed stale for up to 15s
// after an expense write in their group, because only involved payers'/
// participants' own per-user generations were bumped, never the group's.
//
// Real-DB integration test, same convention as
// `wi071-group-write-invalidation.test.ts` (this file's direct template) and
// `wi078-expense-group-generation`'s own spec: fresh users/groups per test,
// driven through app.inject against the real routes, no mocked prisma.
//
// CRITICAL ISOLATION NOTE (carried over verbatim from WI-071's own documented
// finding, re-confirmed independently for expenses below in the "sanity check"
// section): notifications-activity's `recordActivity` (`activity.ts` ~line
// 140) itself calls `bumpUsers(recipientIds)` on every mutation, and for a
// GROUP expense, `recipientIds` is always "every active member"
// (expense-service.ts's own recipient computation). This means a naive
// version of this test would observe correct invalidation of an uninvolved
// third member's cache EVEN IF every `bumpGroupGeneration` call in
// expense-service.ts were removed entirely, because `recordActivity`'s own
// per-user bump already reaches every active member via this side channel.
// `recordActivity` is mocked to a no-op below specifically to isolate
// `bumpGroupGeneration`'s own effect — every other collaborator (prisma, the
// real balances/expenses routes) stays real.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../src/lib/activity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/activity')>();
  return { ...actual, recordActivity: vi.fn().mockResolvedValue(undefined) };
});

import { prisma } from '../src/lib/prisma';
import { buildApp } from '../src/app';

const STAMP = Date.now();
let app: FastifyInstance;
let groupCounter = 0;

const allUserIds: string[] = [];
const allGroupIds: string[] = [];
const allExpenseIds: string[] = [];

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `wi078-expense-ggen-${label}-${STAMP}-${Math.random().toString(36).slice(2, 8)}@test.local`,
      passwordHash: 'not-a-real-hash',
      name: `WI-078 Expense Ggen ${label}`,
      emailNotifications: false,
    },
  });
  allUserIds.push(user.id);
  return user.id;
}

function tokenFor(userId: string) {
  return app.jwt.sign({ sub: userId });
}

function authHeaders(userId: string) {
  return { authorization: `Bearer ${tokenFor(userId)}` };
}

async function createGroup(members: Array<{ userId: string; role?: 'ADMIN' | 'MEMBER' }>) {
  groupCounter += 1;
  const group = await prisma.group.create({
    data: {
      name: 'Goa Trip (WI-078 fixture)',
      inviteCode: `WI078-GGEN-${STAMP}-${groupCounter}`,
      createdById: members[0]!.userId,
      members: { create: members.map((m) => ({ userId: m.userId, role: m.role ?? 'MEMBER' })) },
    },
  });
  allGroupIds.push(group.id);
  return group.id;
}

async function getGroupBalances(userId: string, groupId: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/groups/${groupId}/balances`,
    headers: authHeaders(userId),
  });
}

/** Create a 2-person EQUAL-split expense (group or direct) via the real route. */
async function createExpenseViaRoute(
  actorId: string,
  opts: {
    groupId?: string | null;
    payerId: string;
    participantIds: [string, string];
    amount?: number;
  },
) {
  const amount = opts.amount ?? 2000;
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/expenses',
    headers: authHeaders(actorId),
    payload: {
      groupId: opts.groupId ?? null,
      description: 'WI-078 fixture expense',
      amount,
      currency: 'USD',
      category: 'OTHER',
      date: new Date().toISOString(),
      splitType: 'EQUAL',
      payers: [{ userId: opts.payerId, amount }],
      participants: opts.participantIds.map((userId) => ({ userId })),
    },
  });
  expect(res.statusCode).toBe(201);
  const id = res.json().id as string;
  allExpenseIds.push(id);
  return id;
}

async function updateExpenseAmountViaRoute(
  actorId: string,
  expenseId: string,
  opts: { payerId: string; participantIds: [string, string]; amount: number },
) {
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/v1/expenses/${expenseId}`,
    headers: authHeaders(actorId),
    payload: {
      description: 'WI-078 fixture expense (updated)',
      amount: opts.amount,
      currency: 'USD',
      category: 'OTHER',
      date: new Date().toISOString(),
      splitType: 'EQUAL',
      payers: [{ userId: opts.payerId, amount: opts.amount }],
      participants: opts.participantIds.map((userId) => ({ userId })),
    },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function deleteExpenseViaRoute(actorId: string, expenseId: string) {
  const res = await app.inject({
    method: 'DELETE',
    url: `/api/v1/expenses/${expenseId}`,
    headers: authHeaders(actorId),
  });
  expect(res.statusCode).toBe(204);
}

async function restoreExpenseViaRoute(actorId: string, expenseId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/expenses/${expenseId}/restore`,
    headers: authHeaders(actorId),
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

function memberRow(body: { members: Array<{ user: { id: string }; balances: unknown }> }, userId: string) {
  return body.members.find((m) => m.user.id === userId);
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

describe('spec-WI-078 — an expense write invalidates an UNINVOLVED third member\'s cached group-balances view', () => {
  it('createExpense (POST /expenses) invalidates Priya\'s cached view even though she is not involved', async () => {
    const ana = await createUser('create-ana');
    const sam = await createUser('create-sam');
    const priya = await createUser('create-priya');
    const groupId = await createGroup([
      { userId: ana, role: 'ADMIN' },
      { userId: sam },
      { userId: priya },
    ]);

    const priyaBefore = await getGroupBalances(priya, groupId);
    expect(priyaBefore.statusCode).toBe(200);
    // Sanity: nothing owed yet, so the "after" difference below is caused by
    // the expense write, not incidental fixture noise.
    expect(memberRow(priyaBefore.json(), sam)?.balances).toEqual([]);

    // Ana pays 2000, split evenly with Sam -> Sam owes Ana 1000. Priya is not
    // a payer or participant at all.
    await createExpenseViaRoute(ana, { groupId, payerId: ana, participantIds: [ana, sam], amount: 2000 });

    const priyaAfter = await getGroupBalances(priya, groupId);
    expect(priyaAfter.statusCode).toBe(200);
    expect(priyaAfter.json()).not.toEqual(priyaBefore.json());
    expect(memberRow(priyaAfter.json(), sam)?.balances).toEqual([{ currency: 'USD', amount: -1000 }]);
  });

  it('updateExpense (PATCH /expenses/:id) invalidates Priya\'s cached view', async () => {
    const ana = await createUser('update-ana');
    const sam = await createUser('update-sam');
    const priya = await createUser('update-priya');
    const groupId = await createGroup([
      { userId: ana, role: 'ADMIN' },
      { userId: sam },
      { userId: priya },
    ]);
    const expenseId = await createExpenseViaRoute(ana, {
      groupId,
      payerId: ana,
      participantIds: [ana, sam],
      amount: 2000,
    }); // Sam owes Ana 1000

    const priyaBefore = await getGroupBalances(priya, groupId);
    expect(priyaBefore.statusCode).toBe(200);
    expect(memberRow(priyaBefore.json(), sam)?.balances).toEqual([{ currency: 'USD', amount: -1000 }]);

    // Double the amount -> Sam now owes Ana 2000.
    await updateExpenseAmountViaRoute(ana, expenseId, {
      payerId: ana,
      participantIds: [ana, sam],
      amount: 4000,
    });

    const priyaAfter = await getGroupBalances(priya, groupId);
    expect(priyaAfter.statusCode).toBe(200);
    expect(priyaAfter.json()).not.toEqual(priyaBefore.json());
    expect(memberRow(priyaAfter.json(), sam)?.balances).toEqual([{ currency: 'USD', amount: -2000 }]);
  });

  it('deleteExpense (DELETE /expenses/:id) invalidates Priya\'s cached view', async () => {
    const ana = await createUser('delete-ana');
    const sam = await createUser('delete-sam');
    const priya = await createUser('delete-priya');
    const groupId = await createGroup([
      { userId: ana, role: 'ADMIN' },
      { userId: sam },
      { userId: priya },
    ]);
    const expenseId = await createExpenseViaRoute(ana, {
      groupId,
      payerId: ana,
      participantIds: [ana, sam],
      amount: 2000,
    }); // Sam owes Ana 1000

    const priyaBefore = await getGroupBalances(priya, groupId);
    expect(priyaBefore.statusCode).toBe(200);
    expect(memberRow(priyaBefore.json(), sam)?.balances).toEqual([{ currency: 'USD', amount: -1000 }]);

    await deleteExpenseViaRoute(ana, expenseId);

    const priyaAfter = await getGroupBalances(priya, groupId);
    expect(priyaAfter.statusCode).toBe(200);
    expect(priyaAfter.json()).not.toEqual(priyaBefore.json());
    // The only debt is now soft-deleted -> settled up (nets omit 0 rows).
    expect(memberRow(priyaAfter.json(), sam)?.balances).toEqual([]);
  });

  it('restoreExpense (POST /expenses/:id/restore) invalidates Priya\'s cached view', async () => {
    const ana = await createUser('restore-ana');
    const sam = await createUser('restore-sam');
    const priya = await createUser('restore-priya');
    const groupId = await createGroup([
      { userId: ana, role: 'ADMIN' },
      { userId: sam },
      { userId: priya },
    ]);
    const expenseId = await createExpenseViaRoute(ana, {
      groupId,
      payerId: ana,
      participantIds: [ana, sam],
      amount: 2000,
    }); // Sam owes Ana 1000
    await deleteExpenseViaRoute(ana, expenseId);

    const priyaBeforeRestore = await getGroupBalances(priya, groupId);
    expect(priyaBeforeRestore.statusCode).toBe(200);
    expect(memberRow(priyaBeforeRestore.json(), sam)?.balances).toEqual([]); // delete already settled it up

    await restoreExpenseViaRoute(ana, expenseId);

    const priyaAfterRestore = await getGroupBalances(priya, groupId);
    expect(priyaAfterRestore.statusCode).toBe(200);
    expect(priyaAfterRestore.json()).not.toEqual(priyaBeforeRestore.json());
    expect(memberRow(priyaAfterRestore.json(), sam)?.balances).toEqual([
      { currency: 'USD', amount: -1000 },
    ]);
  });
});

describe('spec-WI-078 — scoping: only the written expense\'s OWN group generation is ever touched', () => {
  it('a DIRECT (non-group) expense between two members of a shared group never bumps that group\'s generation', async () => {
    const ana = await createUser('direct-ana');
    const sam = await createUser('direct-sam');
    const priya = await createUser('direct-priya');
    const groupId = await createGroup([
      { userId: ana, role: 'ADMIN' },
      { userId: sam },
      { userId: priya },
    ]);

    const priyaBefore = await getGroupBalances(priya, groupId);
    expect(priyaBefore.statusCode).toBe(200);

    // Manually wrap (and restore in `finally`) the real prisma client's
    // groupMember.findMany — the very first query computeGroupBalances runs
    // — to PROVE the next read is a genuine cache hit (never recomputed),
    // not merely a recompute that happens to coincide with the old value.
    // (`createExpense`'s own non-group path never calls groupMember.findMany
    // itself — it only calls prisma.user.findMany — so this count is an
    // unconfounded read on the balances route alone.)
    const originalFindMany = prisma.groupMember.findMany.bind(prisma.groupMember);
    let findManyCalls = 0;
    prisma.groupMember.findMany = ((...args: Parameters<typeof originalFindMany>) => {
      findManyCalls += 1;
      return originalFindMany(...args);
    }) as typeof originalFindMany;

    try {
      // A DIRECT (groupId: null) expense between Ana and Sam, who otherwise
      // share `groupId` as their only group — the exact shape of write that
      // would expose a bug where the wrong in-scope groupId got bumped.
      await createExpenseViaRoute(ana, {
        groupId: null,
        payerId: ana,
        participantIds: [ana, sam],
        amount: 2000,
      });

      const priyaAfter = await getGroupBalances(priya, groupId);
      expect(priyaAfter.statusCode).toBe(200);
      expect(priyaAfter.json()).toEqual(priyaBefore.json()); // byte-identical
      expect(findManyCalls).toBe(0); // never recomputed -> group generation was never bumped
    } finally {
      prisma.groupMember.findMany = originalFindMany;
    }
  });

  it('an expense write in group G1 does not invalidate a member\'s cached view scoped to a different group G2', async () => {
    const ana = await createUser('leak-g1-ana');
    const sam = await createUser('leak-g1-sam');
    const priya = await createUser('leak-g2-priya');
    const wendy = await createUser('leak-g2-wendy');
    const g1 = await createGroup([{ userId: ana, role: 'ADMIN' }, { userId: sam }]);
    const g2 = await createGroup([{ userId: priya, role: 'ADMIN' }, { userId: wendy }]);

    const priyaG2Before = await getGroupBalances(priya, g2);
    expect(priyaG2Before.statusCode).toBe(200);

    const originalFindMany = prisma.groupMember.findMany.bind(prisma.groupMember);
    let findManyCalls = 0;
    prisma.groupMember.findMany = ((...args: Parameters<typeof originalFindMany>) => {
      findManyCalls += 1;
      return originalFindMany(...args);
    }) as typeof originalFindMany;

    try {
      await createExpenseViaRoute(ana, { groupId: g1, payerId: ana, participantIds: [ana, sam], amount: 2000 });

      const priyaG2After = await getGroupBalances(priya, g2);
      expect(priyaG2After.statusCode).toBe(200);
      expect(priyaG2After.json()).toEqual(priyaG2Before.json()); // byte-identical
      expect(findManyCalls).toBe(0); // G2's cache entry was never touched by the G1 write
    } finally {
      prisma.groupMember.findMany = originalFindMany;
    }
  });
});
