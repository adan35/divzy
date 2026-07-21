// spec-WI-070 §Decision 1 / §Decision 2b / story-WI-070.md Gherkin ("New
// GET /friends/:userId") — the new single-friend read: field-parity with the
// matching GET /friends entry, structural no-enumeration-leak 404s, 401, and
// the "narrow query" characteristic (does not run the full-friends-list scan
// computeFriendsList performs).
//
// Real-DB integration, mirroring this domain's established convention
// (wi067-cache-endpoints.test.ts / wi070-list-cache.test.ts): real users/
// friendships/expenses/settlements seeded via `prisma`, driven end-to-end
// through `app.inject`. The one white-box assertion (no full-list scan) uses
// `vi.spyOn` directly on the real, imported `prisma.friendship.findMany` —
// spied but NOT mocked (calls through to the real implementation), so every
// other assertion in this file still exercises the genuine DB round-trip.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../src/lib/prisma';
import { resetCacheForTests } from '../src/lib/cache';
import { buildApp } from '../src/app';

const STAMP = Date.now();
let app: FastifyInstance;

const allUserIds: string[] = [];
const allExpenseIds: string[] = [];
const allSettlementIds: string[] = [];

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `wi070-friendread-${label}-${STAMP}-${Math.random().toString(36).slice(2, 8)}@test.local`,
      passwordHash: 'not-a-real-hash',
      name: `WI-070 FriendRead ${label}`,
      emailNotifications: false,
    },
  });
  allUserIds.push(user.id);
  return user;
}

function tokenFor(userId: string) {
  return app.jwt.sign({ sub: userId });
}

function authHeaders(userId: string) {
  return { authorization: `Bearer ${tokenFor(userId)}` };
}

async function makeFriends(aId: string, bId: string) {
  const [userAId, userBId] = aId < bId ? [aId, bId] : [bId, aId];
  await prisma.friendship.create({ data: { userAId, userBId } });
}

/** Direct 2-person expense: `payer` pays the full amount, split evenly with `other`. */
async function createSplitExpense(
  payer: string,
  other: string,
  amountMinor: number,
  currency = 'USD',
) {
  const half = Math.round(amountMinor / 2);
  const expense = await prisma.expense.create({
    data: {
      groupId: null,
      description: 'WI-070 friend-read fixture expense',
      amount: amountMinor,
      currency,
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

async function createSettlement(fromUserId: string, toUserId: string, amountMinor: number) {
  const settlement = await prisma.settlement.create({
    data: {
      groupId: null,
      fromUserId,
      toUserId,
      amount: amountMinor,
      currency: 'USD',
      method: 'CASH',
      date: new Date(),
      createdById: fromUserId,
    },
  });
  allSettlementIds.push(settlement.id);
  return settlement.id;
}

async function getFriend(callerId: string, targetId: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/friends/${targetId}`,
    headers: authHeaders(callerId),
  });
}

async function getFriends(userId: string) {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/friends',
    headers: authHeaders(userId),
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

beforeEach(() => {
  resetCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.expenseSplit.deleteMany({ where: { expenseId: { in: allExpenseIds } } });
  await prisma.expensePayer.deleteMany({ where: { expenseId: { in: allExpenseIds } } });
  await prisma.expense.deleteMany({ where: { id: { in: allExpenseIds } } });
  await prisma.settlement.deleteMany({ where: { id: { in: allSettlementIds } } });
  await prisma.friendship.deleteMany({
    where: { OR: [{ userAId: { in: allUserIds } }, { userBId: { in: allUserIds } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: allUserIds } } });
  await app.close();
});

describe('GET /friends/:userId — field-parity with the matching GET /friends entry', () => {
  it('200 FriendDto is identical, field-for-field, to that friend\'s GET /friends entry at the same moment', async () => {
    const me = await createUser('parity-me');
    const sam = await createUser('parity-sam');
    const alsoFriend = await createUser('parity-other-friend'); // a second friend, to prove the read is pair-scoped not just "only friend"
    await makeFriends(me.id, sam.id);
    await makeFriends(me.id, alsoFriend.id);

    // Multi-currency shared ledger with sam (settlement narrows one currency).
    await createSplitExpense(sam.id, me.id, 6000, 'USD'); // me owes sam 3000 USD
    await createSplitExpense(me.id, sam.id, 2000, 'EUR'); // sam owes me 1000 EUR
    await createSettlement(me.id, sam.id, 1000); // partial settle of the USD debt
    // Unrelated ledger activity with the other friend — must not affect the sam pair.
    await createSplitExpense(alsoFriend.id, me.id, 9999, 'USD');

    const single = await getFriend(me.id, sam.id);
    expect(single.statusCode).toBe(200);
    const singleDto = single.json();

    const list = await getFriends(me.id);
    const listEntry = list.find((f: { user: { id: string } }) => f.user.id === sam.id);
    expect(listEntry).toBeDefined();

    expect(singleDto).toEqual(listEntry);
    // Sanity: the fixture actually produced a nonzero, resolvable balance —
    // not a vacuous [] === [] comparison.
    expect(singleDto.balancesNative.length + (singleDto.balances?.length ?? 0)).toBeGreaterThan(0);
  });

  it('the response is unaffected by an unrelated friend\'s ledger activity (truly pair-scoped)', async () => {
    const me = await createUser('scope-me');
    const sam = await createUser('scope-sam');
    const noisyFriend = await createUser('scope-noisy-friend');
    await makeFriends(me.id, sam.id);
    await makeFriends(me.id, noisyFriend.id);
    // No shared history with sam at all -> settled/empty balances.
    await createSplitExpense(noisyFriend.id, me.id, 500000, 'USD');

    const res = await getFriend(me.id, sam.id);
    expect(res.statusCode).toBe(200);
    const dto = res.json();
    expect(dto.balancesNative).toEqual([]);
    expect(dto.balances).toEqual([]);
    expect(dto.balancesConverted).toBeNull();
  });
});

describe('GET /friends/:userId — no-enumeration-leak 404s', () => {
  it('404 FRIENDSHIP_NOT_FOUND when no Friendship row exists (never-friended target)', async () => {
    const me = await createUser('404-me');
    const stranger = await createUser('404-stranger');

    const res = await getFriend(me.id, stranger.id);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('FRIENDSHIP_NOT_FOUND');
  });

  it('404 identical shape for a self-request (:userId = caller\'s own id)', async () => {
    const me = await createUser('404-self');

    const res = await getFriend(me.id, me.id);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('FRIENDSHIP_NOT_FOUND');
  });

  it('the never-friended-target and self-target 404s are byte-identical in shape (no distinguishing branch)', async () => {
    const me = await createUser('404-shape-me');
    const stranger = await createUser('404-shape-stranger');

    const strangerRes = await getFriend(me.id, stranger.id);
    const selfRes = await getFriend(me.id, me.id);

    expect(strangerRes.statusCode).toBe(selfRes.statusCode);
    expect(strangerRes.json().code).toBe(selfRes.json().code);
  });

  it('a previously-unfriended target (row deleted) also 404s the same way', async () => {
    const me = await createUser('404-unfriended-me');
    const exFriend = await createUser('404-unfriended-ex');
    await makeFriends(me.id, exFriend.id);
    const [userAId, userBId] =
      me.id < exFriend.id ? [me.id, exFriend.id] : [exFriend.id, me.id];
    await prisma.friendship.delete({ where: { userAId_userBId: { userAId, userBId } } });

    const res = await getFriend(me.id, exFriend.id);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('FRIENDSHIP_NOT_FOUND');
  });
});

describe('GET /friends/:userId — unauthenticated', () => {
  it('401 when no valid session', async () => {
    const me = await createUser('401-me');
    const sam = await createUser('401-sam');
    await makeFriends(me.id, sam.id);

    const res = await app.inject({ method: 'GET', url: `/api/v1/friends/${sam.id}` });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /friends/:userId — narrow query (no full-friends-list scan)', () => {
  it('does NOT call prisma.friendship.findMany (the all-friends scan computeFriendsList performs)', async () => {
    const me = await createUser('narrow-me');
    const sam = await createUser('narrow-sam');
    const other = await createUser('narrow-other');
    await makeFriends(me.id, sam.id);
    await makeFriends(me.id, other.id);

    // NOTE: vi.spyOn's default call-through does NOT work transparently on
    // Prisma Client model methods here (observed: breaks the internal
    // Promise.all batching, "friendships is not iterable") — bind the
    // original first and call it explicitly from the mock implementation.
    const originalFindMany = prisma.friendship.findMany.bind(prisma.friendship);
    const findManySpy = vi
      .spyOn(prisma.friendship, 'findMany')
      .mockImplementation((...args: Parameters<typeof originalFindMany>) => originalFindMany(...args));

    const res = await getFriend(me.id, sam.id);
    expect(res.statusCode).toBe(200);
    expect(findManySpy).not.toHaveBeenCalled();

    // Contrast: GET /friends (computeFriendsList) DOES call it — proves the
    // spy would have caught a scan if the new endpoint had one.
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/friends',
      headers: authHeaders(me.id),
    });
    expect(listRes.statusCode).toBe(200);
    expect(findManySpy).toHaveBeenCalled();
  });

  it('uses a single findUnique pair lookup for the friendship row', async () => {
    const me = await createUser('narrow2-me');
    const sam = await createUser('narrow2-sam');
    await makeFriends(me.id, sam.id);

    const originalFindUnique = prisma.friendship.findUnique.bind(prisma.friendship);
    const findUniqueSpy = vi
      .spyOn(prisma.friendship, 'findUnique')
      .mockImplementation((...args: Parameters<typeof originalFindUnique>) =>
        originalFindUnique(...args),
      );

    const res = await getFriend(me.id, sam.id);
    expect(res.statusCode).toBe(200);
    expect(findUniqueSpy).toHaveBeenCalledTimes(1);
    const [userAId, userBId] = me.id < sam.id ? [me.id, sam.id] : [sam.id, me.id];
    expect(findUniqueSpy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userAId_userBId: { userAId, userBId } } }),
    );
  });
});
