// spec-WI-071.md §1.4 / ADR-031 — "A group settlement write invalidates every
// active member's cached balances view, not just the two direct parties".
// This is the load-bearing new behavior WI-071 adds (not just "wire up
// caching") — the story's own "Priya" scenario, constructed explicitly per
// the task brief: Priya (an uninvolved third member) caches a response, Ana
// settles with Sam, and Priya's NEXT call must reflect the change, never a
// stale hit.
//
// Real-DB integration, same convention as wi071-group-balances-cache.test.ts
// and wi067-bump-sites.test.ts: fresh users/groups per test, driven through
// app.inject against the real routes.
//
// IMPORTANT ISOLATION NOTE (found while writing this file, not previously
// flagged by Build/Spec): notifications-activity's concurrent WI-073 change
// (`recordActivity`'s `bumpUsers(recipientIds)`, activity.ts:136-140) ALSO
// bumps every active group member's own per-USER generation whenever a
// group-scoped settlement fires its SETTLEMENT_ADDED/DELETED/RESTORED
// activity — because `recipientIds` for a group settlement is always "every
// active member" (settlements.ts's own recipient computation, unrelated to
// ADR-031). Since `cacheKey()` always folds in `userGeneration(userId)`
// regardless of the new `ggen` component, THIS confounds a real-DB,
// full-stack test of "an uninvolved third member's cache is invalidated
// after a settlement write": Priya's cache gets invalidated via the
// pre-existing per-user path too, so a naive version of this test could not
// tell `bumpGroupGeneration` apart from an unrelated side channel (confirmed
// experimentally: temporarily neutering every `bumpGroupGeneration` call
// site left every test below still green). `recordActivity` is mocked to a
// no-op below specifically to isolate ADR-031's OWN mechanism — every other
// collaborator (prisma, settlements/balances routes) stays real.
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
const allSettlementIds: string[] = [];

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `wi071-invalidation-${label}-${STAMP}-${Math.random().toString(36).slice(2, 8)}@test.local`,
      passwordHash: 'not-a-real-hash',
      name: `WI-071 Invalidation ${label}`,
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
      name: 'Goa Trip (WI-071 fixture)',
      inviteCode: `WI071-INVAL-${STAMP}-${groupCounter}`,
      createdById: members[0]!.userId,
      members: { create: members.map((m) => ({ userId: m.userId, role: m.role ?? 'MEMBER' })) },
    },
  });
  allGroupIds.push(group.id);
  return group.id;
}

/** Direct 2-person expense: `payer` pays the full amount, split evenly with `other`. */
async function createSplitExpense(groupId: string, payer: string, other: string, amountMinor: number) {
  const half = Math.round(amountMinor / 2);
  const expense = await prisma.expense.create({
    data: {
      groupId,
      description: 'WI-071 invalidation fixture expense',
      amount: amountMinor,
      currency: 'USD',
      category: 'OTHER',
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

async function getGroupBalances(userId: string, groupId: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/groups/${groupId}/balances`,
    headers: authHeaders(userId),
  });
}

async function createSettlementViaRoute(
  actorId: string,
  opts: { fromUserId: string; toUserId: string; amount: number; groupId?: string | null },
) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/settlements',
    headers: authHeaders(actorId),
    payload: {
      groupId: opts.groupId ?? null,
      fromUserId: opts.fromUserId,
      toUserId: opts.toUserId,
      amount: opts.amount,
      currency: 'USD',
      method: 'CASH',
      date: new Date().toISOString(),
    },
  });
  expect(res.statusCode).toBe(201);
  const id = res.json().id as string;
  allSettlementIds.push(id);
  return id;
}

async function deleteSettlementViaRoute(actorId: string, settlementId: string) {
  const res = await app.inject({
    method: 'DELETE',
    url: `/api/v1/settlements/${settlementId}`,
    headers: authHeaders(actorId),
  });
  expect(res.statusCode).toBe(204);
}

async function restoreSettlementViaRoute(actorId: string, settlementId: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/settlements/${settlementId}/restore`,
    headers: authHeaders(actorId),
  });
  expect(res.statusCode).toBe(200);
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await prisma.expenseSplit.deleteMany({ where: { expenseId: { in: allExpenseIds } } });
  await prisma.expensePayer.deleteMany({ where: { expenseId: { in: allExpenseIds } } });
  await prisma.expense.deleteMany({ where: { id: { in: allExpenseIds } } });
  await prisma.settlement.deleteMany({ where: { id: { in: allSettlementIds } } });
  await prisma.groupMember.deleteMany({ where: { groupId: { in: allGroupIds } } });
  await prisma.group.deleteMany({ where: { id: { in: allGroupIds } } });
  await prisma.friendship.deleteMany({
    where: { OR: [{ userAId: { in: allUserIds } }, { userBId: { in: allUserIds } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: allUserIds } } });
  await app.close();
});

describe('ADR-031 — a settlement write invalidates an UNINVOLVED third member\'s cached view', () => {
  it('Ana settling with Sam invalidates Priya\'s cached group-balances, even though Priya was not a party', async () => {
    const ana = await createUser('settle-ana');
    const sam = await createUser('settle-sam');
    const priya = await createUser('settle-priya');
    const groupId = await createGroup([
      { userId: ana, role: 'ADMIN' },
      { userId: sam },
      { userId: priya },
    ]);
    // Sam owes Ana 1000 -> a debt Ana can settle.
    await createSplitExpense(groupId, ana, sam, 2000);

    const priyaBefore = await getGroupBalances(priya, groupId);
    expect(priyaBefore.statusCode).toBe(200);

    await createSettlementViaRoute(sam, { fromUserId: sam, toUserId: ana, amount: 500, groupId });

    const priyaAfter = await getGroupBalances(priya, groupId);
    expect(priyaAfter.statusCode).toBe(200);
    expect(priyaAfter.json()).not.toEqual(priyaBefore.json());
    // Sam's own net (a member row Priya can see) should now reflect the paydown.
    const samRowAfter = priyaAfter.json().members.find(
      (m: { user: { id: string } }) => m.user.id === sam,
    );
    expect(samRowAfter.balances).toEqual([{ currency: 'USD', amount: -500 }]);
  });

  it('deleting a settlement invalidates every active member\'s cached view, including an uninvolved third member', async () => {
    const ana = await createUser('delete-ana');
    const sam = await createUser('delete-sam');
    const priya = await createUser('delete-priya');
    const groupId = await createGroup([
      { userId: ana, role: 'ADMIN' },
      { userId: sam },
      { userId: priya },
    ]);
    await createSplitExpense(groupId, ana, sam, 2000); // sam owes ana 1000
    const settlementId = await createSettlementViaRoute(sam, {
      fromUserId: sam,
      toUserId: ana,
      amount: 400,
      groupId,
    });

    const priyaBefore = await getGroupBalances(priya, groupId);
    expect(priyaBefore.statusCode).toBe(200);

    await deleteSettlementViaRoute(ana, settlementId);

    const priyaAfter = await getGroupBalances(priya, groupId);
    expect(priyaAfter.json()).not.toEqual(priyaBefore.json());
    const samRowAfter = priyaAfter.json().members.find(
      (m: { user: { id: string } }) => m.user.id === sam,
    );
    // The 400 paydown was reversed by the delete -> sam is back to owing the full 1000.
    expect(samRowAfter.balances).toEqual([{ currency: 'USD', amount: -1000 }]);
  });

  it('restoring a settlement invalidates every active member\'s cached view, including an uninvolved third member', async () => {
    const ana = await createUser('restore-ana');
    const sam = await createUser('restore-sam');
    const priya = await createUser('restore-priya');
    const groupId = await createGroup([
      { userId: ana, role: 'ADMIN' },
      { userId: sam },
      { userId: priya },
    ]);
    await createSplitExpense(groupId, ana, sam, 2000); // sam owes ana 1000
    const settlementId = await createSettlementViaRoute(sam, {
      fromUserId: sam,
      toUserId: ana,
      amount: 400,
      groupId,
    });
    await deleteSettlementViaRoute(ana, settlementId);

    const priyaBefore = await getGroupBalances(priya, groupId);
    expect(priyaBefore.statusCode).toBe(200);
    const samRowBefore = priyaBefore.json().members.find(
      (m: { user: { id: string } }) => m.user.id === sam,
    );
    expect(samRowBefore.balances).toEqual([{ currency: 'USD', amount: -1000 }]); // delete already reversed

    await restoreSettlementViaRoute(ana, settlementId);

    const priyaAfter = await getGroupBalances(priya, groupId);
    expect(priyaAfter.json()).not.toEqual(priyaBefore.json());
    const samRowAfter = priyaAfter.json().members.find(
      (m: { user: { id: string } }) => m.user.id === sam,
    );
    expect(samRowAfter.balances).toEqual([{ currency: 'USD', amount: -600 }]); // 400 paydown re-applied
  });
});

describe('ADR-031 — a DIRECT (non-group) settlement does NOT trigger group-wide invalidation', () => {
  it('a direct settlement between two members of a shared group leaves a third member\'s cached group-balances unaffected', async () => {
    const ana = await createUser('direct-ana');
    const sam = await createUser('direct-sam');
    const priya = await createUser('direct-priya');
    const groupId = await createGroup([
      { userId: ana, role: 'ADMIN' },
      { userId: sam },
      { userId: priya },
    ]);
    // A real, genuinely-payable bilateral debt (Sam owes Ana 1000), so the
    // direct settlement below is a real 201, not a moot 400 that would never
    // reach the write path's bump calls either way. Note (ADR-009): since Goa
    // Trip is Ana & Sam's SOLE shared group, this direct settlement would, if
    // recomputed fresh, actually be attributed into the group's own pairwise
    // view — this test's whole point is that it must NOT be recomputed fresh
    // (Priya's cache must stay exactly as it was), a deliberate, documented,
    // TTL-bounded accepted limitation (spec-WI-071.md §1.4).
    await createSplitExpense(groupId, ana, sam, 2000);

    const priyaBefore = await getGroupBalances(priya, groupId);
    expect(priyaBefore.statusCode).toBe(200);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/settlements',
      headers: authHeaders(ana),
      payload: {
        groupId: null,
        fromUserId: sam,
        toUserId: ana,
        amount: 500,
        currency: 'USD',
        method: 'CASH',
        date: new Date().toISOString(),
      },
    });
    expect(res.statusCode).toBe(201); // a genuine write happened, not a moot rejection
    allSettlementIds.push(res.json().id as string);

    const priyaAfter = await getGroupBalances(priya, groupId);
    expect(priyaAfter.json()).toEqual(priyaBefore.json()); // byte-identical: no group generation bump occurred
  });
});
