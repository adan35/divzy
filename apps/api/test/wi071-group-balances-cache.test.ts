// spec-WI-071.md §1.2 / story-WI-071.md "GET /groups/:groupId/balances is
// wired into the response cache, scoped correctly by user and group" —
// real-DB integration, mirroring this domain's established convention for
// cache-wrap tests (wi067-cache-endpoints.test.ts): real users/groups/
// expenses seeded via `prisma`, driven end-to-end through `app.inject`
// against the real route. Every fixture below uses its OWN freshly-created
// users/groups (unique per test), so the process-wide cache singletons in
// lib/cache.ts never need `resetCacheForTests()` here — same reasoning as
// wi067-cache-endpoints.test.ts.
//
// Proof technique for "served from cache, not recomputed": mutate the
// underlying ledger DIRECTLY via prisma (bypassing every WI-071/ADR-031 bump
// site on purpose) and assert the response is STILL the pre-mutation value —
// plus a manual call-counting wrap (restored in `finally`, not `vi.spyOn`,
// which does not cleanly restore Prisma's client-delegate methods) around
// the real prisma client's groupMember.findMany, proving the full ledger
// load genuinely did not re-run on the cached hit.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../src/lib/prisma';
import { buildApp } from '../src/app';

const STAMP = Date.now();
let app: FastifyInstance;
let groupCounter = 0;

const allUserIds: string[] = [];
const allGroupIds: string[] = [];
const allExpenseIds: string[] = [];

async function createUser(label: string, defaultCurrency = 'USD') {
  const user = await prisma.user.create({
    data: {
      email: `wi071-cache-${label}-${STAMP}-${Math.random().toString(36).slice(2, 8)}@test.local`,
      passwordHash: 'not-a-real-hash',
      name: `WI-071 Cache ${label}`,
      emailNotifications: false,
      defaultCurrency,
    },
  });
  allUserIds.push(user.id);
  return user.id;
}

function tokenFor(userId: string) {
  return app.jwt.sign({ sub: userId });
}

async function createGroup(members: Array<{ userId: string; role?: 'ADMIN' | 'MEMBER' }>) {
  groupCounter += 1;
  const group = await prisma.group.create({
    data: {
      name: 'WI-071 Cache Fixture Trip',
      inviteCode: `WI071-CACHE-${STAMP}-${groupCounter}`,
      createdById: members[0]!.userId,
      members: {
        create: members.map((m) => ({ userId: m.userId, role: m.role ?? 'MEMBER' })),
      },
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
      description: 'WI-071 cache fixture expense',
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
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/groups/${groupId}/balances`,
    headers: { authorization: `Bearer ${tokenFor(userId)}` },
  });
  return res;
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

describe('GET /groups/:groupId/balances — cached() wrap (15s TTL, spec §1.2)', () => {
  it('a repeated read within the TTL is byte-identical AND does not re-hit Postgres (call-count assertion)', async () => {
    const ana = await createUser('repeat-ana');
    const sam = await createUser('repeat-sam');
    const groupId = await createGroup([{ userId: ana, role: 'ADMIN' }, { userId: sam }]);
    await createSplitExpense(groupId, ana, sam, 1000); // sam owes ana 500

    const first = await getGroupBalances(ana, groupId);
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();

    // Mutate the underlying ledger DIRECTLY (no route, no bump site) — the
    // real balance sheet has now changed, but a warm cache entry doesn't know that.
    await createSplitExpense(groupId, ana, sam, 1000);

    // Manually wrap (and restore in `finally`) the real prisma client's
    // groupMember.findMany to prove the second call never re-runs the
    // membership/ledger load — a genuine cache hit, not a recompute that
    // happens to coincide with the old value.
    const originalFindMany = prisma.groupMember.findMany.bind(prisma.groupMember);
    let findManyCalls = 0;
    prisma.groupMember.findMany = ((...args: Parameters<typeof originalFindMany>) => {
      findManyCalls += 1;
      return originalFindMany(...args);
    }) as typeof originalFindMany;

    try {
      const second = await getGroupBalances(ana, groupId);
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual(firstBody); // byte-identical
      expect(findManyCalls).toBe(0);
    } finally {
      prisma.groupMember.findMany = originalFindMany;
    }
  });

  it('two different users viewing the same group never share a cache entry (per-viewer isolation)', async () => {
    const ana = await createUser('isolate-ana', 'USD');
    const sam = await createUser('isolate-sam', 'EUR');
    const groupId = await createGroup([{ userId: ana, role: 'ADMIN' }, { userId: sam }]);
    await createSplitExpense(groupId, ana, sam, 800); // sam owes ana 400

    const anaFirst = await getGroupBalances(ana, groupId);
    const samFirst = await getGroupBalances(sam, groupId);
    expect(anaFirst.json().viewerCurrency).toBe('USD');
    expect(samFirst.json().viewerCurrency).toBe('EUR');
    expect(anaFirst.json()).not.toEqual(samFirst.json());

    // Mutate directly, then re-read: Ana's own cached entry must stay stale
    // for Ana specifically (proves Ana has a genuine, independent cache slot,
    // not merely "different because the initial computation differed").
    await createSplitExpense(groupId, ana, sam, 800);
    const anaStillCached = await getGroupBalances(ana, groupId);
    expect(anaStillCached.json()).toEqual(anaFirst.json());
    const samStillCached = await getGroupBalances(sam, groupId);
    expect(samStillCached.json()).toEqual(samFirst.json());
  });

  it('the same user viewing two different groups never shares a cache entry (per-group isolation)', async () => {
    const ana = await createUser('twogroups-ana');
    const sam = await createUser('twogroups-sam');
    const goaTrip = await createGroup([{ userId: ana, role: 'ADMIN' }, { userId: sam }]);
    const bookClub = await createGroup([{ userId: ana, role: 'ADMIN' }, { userId: sam }]);
    await createSplitExpense(goaTrip, ana, sam, 1000); // sam owes ana 500 in Goa Trip
    await createSplitExpense(bookClub, sam, ana, 400); // ana owes sam 200 in Book Club

    const goaFirst = await getGroupBalances(ana, goaTrip);
    const bookFirst = await getGroupBalances(ana, bookClub);
    expect(goaFirst.json().groupId).toBe(goaTrip);
    expect(bookFirst.json().groupId).toBe(bookClub);
    expect(goaFirst.json()).not.toEqual(bookFirst.json());

    // Mutate Goa Trip's ledger directly; Book Club's independently-cached
    // entry must be completely unaffected, and Goa Trip's own cached entry
    // must still be the stale pre-mutation value (proves two distinct slots).
    await createSplitExpense(goaTrip, ana, sam, 1000);
    const goaStillCached = await getGroupBalances(ana, goaTrip);
    expect(goaStillCached.json()).toEqual(goaFirst.json());
    const bookStillCached = await getGroupBalances(ana, bookClub);
    expect(bookStillCached.json()).toEqual(bookFirst.json());
  });

  it('a former member gets 404 on their very next call, even with a warm cache entry (auth-before-cache)', async () => {
    const ana = await createUser('former-ana');
    const priya = await createUser('former-priya');
    const groupId = await createGroup([{ userId: ana, role: 'ADMIN' }, { userId: priya }]);
    await createSplitExpense(groupId, ana, priya, 600);

    const cached = await getGroupBalances(priya, groupId);
    expect(cached.statusCode).toBe(200); // Priya's read is now warm in the cache

    // Priya leaves the group (bypassing the route entirely — the point is to
    // prove the MEMBERSHIP CHECK itself runs fresh, not that leave's own bump
    // site works; a naive implementation might move assertActiveMember inside
    // cached() and thus never re-check this).
    await prisma.groupMember.updateMany({
      where: { groupId, userId: priya },
      data: { leftAt: new Date() },
    });

    const afterLeaving = await getGroupBalances(priya, groupId);
    expect(afterLeaving.statusCode).toBe(404);
    expect(afterLeaving.json().code ?? afterLeaving.json().error?.code).toBe('NOT_FOUND');
  });

  it('a non-member is 404 on the very first call (existence never leaks, unaffected by caching)', async () => {
    const ana = await createUser('nonmember-ana');
    const outsider = await createUser('nonmember-outsider');
    const groupId = await createGroup([{ userId: ana, role: 'ADMIN' }]);

    const res = await getGroupBalances(outsider, groupId);
    expect(res.statusCode).toBe(404);
  });
});
