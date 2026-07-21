// spec-WI-070 §Decision 3 / story-WI-070.md Gherkin ("GET /groups caching",
// "GET /friends caching") — cache-correctness regression for wrapping
// GET /groups and GET /friends in the existing cached()/cacheKey()/bumpUsers()
// machinery from lib/cache.ts (WI-067/ADR-030).
//
// Real-DB integration, mirroring this domain's established convention for
// cache-correctness tests (wi067-cache-endpoints.test.ts / wi067-bump-sites.
// test.ts): real users/groups/expenses/friendships seeded via `prisma`,
// driven end-to-end through `app.inject` against the real routes.
//
// Core proof technique for "a cached response is reused without recomputing"
// (mirrors wi067-cache-endpoints.test.ts exactly): read once, mutate the
// underlying row DIRECTLY via prisma (bypassing every bumpUsers() call site
// on purpose), read again and assert the response is STILL the pre-mutation
// value (proves a real cache hit, not a coincidence), then bump the
// generation directly (or via the real mutation route, for the invalidation
// scenarios) and read once more to confirm the change is now visible.
//
// resetCacheForTests() is called in beforeEach per spec-WI-070's explicit
// "Testability note" — responseStore/generationStore are process-wide
// singletons (lib/cache.ts), so a stale hit from an earlier test in this (or
// any other) file would otherwise leak in.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../src/lib/prisma';
import { bumpUserGeneration, resetCacheForTests, userGeneration } from '../src/lib/cache';
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
      email: `wi070-cache-${label}-${STAMP}-${Math.random().toString(36).slice(2, 8)}@test.local`,
      passwordHash: 'not-a-real-hash',
      name: `WI-070 Cache ${label}`,
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

async function createGroupDirect(
  creatorId: string,
  members: Array<{ userId: string; role: 'ADMIN' | 'MEMBER' }>,
  overrides: { name?: string } = {},
) {
  groupCounter += 1;
  const group = await prisma.group.create({
    data: {
      name: overrides.name ?? 'WI-070 Cache Fixture',
      inviteCode: `WI070-CACHE-${STAMP}-${groupCounter}`,
      createdById: creatorId,
      members: { create: members.map((m) => ({ userId: m.userId, role: m.role })) },
    },
  });
  allGroupIds.push(group.id);
  return group.id;
}

/** Direct 2-person expense: `payer` pays the full amount, split evenly with `other`. */
async function createSplitExpense(
  payer: string,
  other: string,
  amountMinor: number,
  opts: { groupId?: string } = {},
) {
  const half = Math.round(amountMinor / 2);
  const expense = await prisma.expense.create({
    data: {
      groupId: opts.groupId ?? null,
      description: 'WI-070 cache fixture expense',
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

async function getGroups(userId: string) {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/groups',
    headers: authHeaders(userId),
  });
  expect(res.statusCode).toBe(200);
  return res.json();
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

async function postGroup(userId: string, name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/groups',
    headers: authHeaders(userId),
    payload: { name, type: 'OTHER', currency: 'USD' },
  });
  expect(res.statusCode).toBe(201);
  const id = res.json().id as string;
  allGroupIds.push(id);
  return id;
}

async function patchGroup(userId: string, groupId: string, payload: Record<string, unknown>) {
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/v1/groups/${groupId}`,
    headers: authHeaders(userId),
    payload,
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function addFriendByEmail(actorId: string, targetEmail: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/friends',
    headers: authHeaders(actorId),
    payload: { identifier: targetEmail },
  });
}

async function deleteFriend(actorId: string, targetId: string) {
  return app.inject({
    method: 'DELETE',
    url: `/api/v1/friends/${targetId}`,
    headers: authHeaders(actorId),
  });
}

async function makeFriends(aId: string, bId: string) {
  const [userAId, userBId] = aId < bId ? [aId, bId] : [bId, aId];
  await prisma.friendship.create({ data: { userAId, userBId } });
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

beforeEach(() => {
  // Mandatory per spec-WI-070's Testability note: responseStore/
  // generationStore are process-wide singletons.
  resetCacheForTests();
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

describe('GET /groups — cached() wrap (15s TTL)', () => {
  it('a second call within the TTL is byte-identical and does NOT recompute (computeGroupsList runs once)', async () => {
    const admin = await createUser('groups-recompute-admin');
    const member = await createUser('groups-recompute-member');
    const groupId = await createGroupDirect(admin.id, [
      { userId: admin.id, role: 'ADMIN' },
      { userId: member.id, role: 'MEMBER' },
    ]);

    const first = await getGroups(admin.id);
    expect(first).toHaveLength(1);
    expect(first[0].id).toBe(groupId);

    // Mutate the underlying row DIRECTLY (no route, no bumpUsers call) — a
    // real recompute would now see the new name.
    await prisma.group.update({ where: { id: groupId }, data: { name: 'Renamed Directly' } });

    const stillCached = await getGroups(admin.id);
    expect(stillCached).toEqual(first); // byte-for-byte identical -> proves a real hit, no recompute

    bumpUserGeneration(admin.id);

    const fresh = await getGroups(admin.id);
    expect(fresh[0].name).toBe('Renamed Directly');
    expect(fresh).not.toEqual(first);
  });
});

describe('GET /friends — cached() wrap (15s TTL)', () => {
  it('a second call within the TTL is byte-identical and does NOT recompute (computeFriendsList runs once)', async () => {
    const ana = await createUser('friends-recompute-ana');
    const sam = await createUser('friends-recompute-sam');
    await makeFriends(ana.id, sam.id);
    await createSplitExpense(ana.id, sam.id, 1000); // sam owes ana 500

    const first = await getFriends(ana.id);
    expect(first).toHaveLength(1);
    expect(first[0].balancesNative).toEqual([{ currency: 'USD', amount: 500 }]);

    // Mutate the ledger DIRECTLY (no route, no bumpUsers call).
    await createSplitExpense(ana.id, sam.id, 1000);

    const stillCached = await getFriends(ana.id);
    expect(stillCached).toEqual(first);

    bumpUserGeneration(ana.id);

    const fresh = await getFriends(ana.id);
    expect(fresh[0].balancesNative).toEqual([{ currency: 'USD', amount: 1000 }]);
    expect(fresh).not.toEqual(first);
  });
});

describe('Cross-user cache isolation (cacheKey embeds userId)', () => {
  it('GET /groups: two users never see each other\'s cached data', async () => {
    const a = await createUser('groups-isolation-a');
    const b = await createUser('groups-isolation-b');
    const groupA = await createGroupDirect(a.id, [{ userId: a.id, role: 'ADMIN' }], {
      name: 'Group A',
    });
    const groupB = await createGroupDirect(b.id, [{ userId: b.id, role: 'ADMIN' }], {
      name: 'Group B',
    });

    const resA = await getGroups(a.id);
    const resB = await getGroups(b.id);

    expect(resA).toHaveLength(1);
    expect(resA[0].id).toBe(groupA);
    expect(resB).toHaveLength(1);
    expect(resB[0].id).toBe(groupB);
    expect(resA[0].id).not.toBe(resB[0].id);
  });

  it('GET /friends: two users never see each other\'s cached data', async () => {
    const a = await createUser('friends-isolation-a');
    const b = await createUser('friends-isolation-b');
    const aFriend = await createUser('friends-isolation-a-friend');
    const bFriend = await createUser('friends-isolation-b-friend');
    await makeFriends(a.id, aFriend.id);
    await makeFriends(b.id, bFriend.id);

    const resA = await getFriends(a.id);
    const resB = await getFriends(b.id);

    expect(resA).toHaveLength(1);
    expect(resA[0].user.id).toBe(aFriend.id);
    expect(resB).toHaveLength(1);
    expect(resB[0].user.id).toBe(bFriend.id);
  });
});

describe('Invalidation site G8 — POST /groups bumps the creator\'s cached GET /groups', () => {
  it('creating a group makes the next GET /groups reflect it immediately, not after a 15s wait', async () => {
    const user = await createUser('g8-user');
    const existingGroupId = await createGroupDirect(user.id, [{ userId: user.id, role: 'ADMIN' }]);

    const before = await getGroups(user.id);
    expect(before).toHaveLength(1);
    expect(before[0].id).toBe(existingGroupId);

    const newGroupId = await postGroup(user.id, 'Brand New Group');

    const after = await getGroups(user.id);
    expect(after.map((g: { id: string }) => g.id)).toContain(newGroupId);
    expect(after).toHaveLength(2);
  });
});

describe('Invalidation site — PATCH /groups/:groupId bumps every active member\'s cached GET /groups', () => {
  it('editing name/emoji/type/currency is reflected immediately for every active member', async () => {
    const admin = await createUser('patch-admin');
    const member = await createUser('patch-member');
    const groupId = await createGroupDirect(admin.id, [
      { userId: admin.id, role: 'ADMIN' },
      { userId: member.id, role: 'MEMBER' },
    ]);

    // Warm both members' caches.
    const adminBefore = await getGroups(admin.id);
    const memberBefore = await getGroups(member.id);
    expect(adminBefore[0].name).toBe('WI-070 Cache Fixture');
    expect(memberBefore[0].name).toBe('WI-070 Cache Fixture');

    await patchGroup(member.id, groupId, { name: 'Edited By Member' });

    const adminAfter = await getGroups(admin.id);
    const memberAfter = await getGroups(member.id);
    expect(adminAfter[0].name).toBe('Edited By Member');
    expect(memberAfter[0].name).toBe('Edited By Member');
  });
});

describe('Pre-existing G1-G7 sites already cover the newly-cached endpoints (shared per-user generation)', () => {
  it('POST /groups/join (G1) invalidates the joiner\'s cached GET /groups and GET /friends', async () => {
    const admin = await createUser('g1-admin');
    const joiner = await createUser('g1-joiner');
    const groupId = await createGroupDirect(admin.id, [{ userId: admin.id, role: 'ADMIN' }]);
    const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });

    // Warm the joiner's caches (empty groups/friends before joining).
    const groupsBefore = await getGroups(joiner.id);
    const friendsBefore = await getFriends(joiner.id);
    expect(groupsBefore).toEqual([]);
    expect(friendsBefore).toEqual([]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/groups/join',
      headers: authHeaders(joiner.id),
      payload: { code: group.inviteCode },
    });
    expect(res.statusCode).toBe(200);

    const groupsAfter = await getGroups(joiner.id);
    const friendsAfter = await getFriends(joiner.id);
    expect(groupsAfter.map((g: { id: string }) => g.id)).toContain(groupId);
    // ensureFriendshipsAmong auto-friends the joiner with existing active members.
    expect(friendsAfter.map((f: { user: { id: string } }) => f.user.id)).toContain(admin.id);
    expect(friendsAfter).not.toEqual(friendsBefore);
  });
});

describe('Invalidation — addFriendPair genuine-new-friendship path bumps both parties\' cached GET /friends', () => {
  it('POST /friends (by email) invalidates both users\' cached GET /friends immediately', async () => {
    const a = await createUser('addfriend-a');
    const b = await prisma.user.create({
      data: {
        email: `wi070-addfriend-b-${STAMP}@test.local`,
        passwordHash: 'not-a-real-hash',
        name: 'WI-070 Cache addfriend-b',
        emailNotifications: false,
      },
    });
    allUserIds.push(b.id);

    const aBefore = await getFriends(a.id);
    const bBefore = await getFriends(b.id);
    expect(aBefore).toEqual([]);
    expect(bBefore).toEqual([]);

    const res = await addFriendByEmail(a.id, b.email);
    expect(res.statusCode).toBe(201);

    const aAfter = await getFriends(a.id);
    const bAfter = await getFriends(b.id);
    expect(aAfter.map((f: { user: { id: string } }) => f.user.id)).toContain(b.id);
    expect(bAfter.map((f: { user: { id: string } }) => f.user.id)).toContain(a.id);
  });

  it('re-adding an already-existing friendship (idempotent path) does NOT bump generation, and the list still looks correct', async () => {
    const a = await createUser('readd-a');
    const b = await prisma.user.create({
      data: {
        email: `wi070-readd-b-${STAMP}@test.local`,
        passwordHash: 'not-a-real-hash',
        name: 'WI-070 Cache readd-b',
        emailNotifications: false,
      },
    });
    allUserIds.push(b.id);
    await makeFriends(a.id, b.id);

    // Warm both caches.
    const aBefore = await getFriends(a.id);
    const bBefore = await getFriends(b.id);
    expect(aBefore).toHaveLength(1);
    expect(bBefore).toHaveLength(1);

    const genABefore = userGeneration(a.id);
    const genBBefore = userGeneration(b.id);

    const res = await addFriendByEmail(a.id, b.email); // already friends -> idempotent re-add
    expect(res.statusCode).toBe(201);

    expect(userGeneration(a.id)).toBe(genABefore);
    expect(userGeneration(b.id)).toBe(genBBefore);

    // Still correct (cache reused, no invalidation needed since nothing changed).
    const aAfter = await getFriends(a.id);
    const bAfter = await getFriends(b.id);
    expect(aAfter).toEqual(aBefore);
    expect(bAfter).toEqual(bBefore);
  });
});

describe('Invalidation — DELETE /friends/:userId bumps both parties ONLY on success', () => {
  it('a successful removal (settled pair) invalidates both users\' cached GET /friends immediately', async () => {
    const a = await createUser('delfriend-a');
    const b = await createUser('delfriend-b');
    await makeFriends(a.id, b.id); // fully settled — no ledger rows

    const aBefore = await getFriends(a.id);
    const bBefore = await getFriends(b.id);
    expect(aBefore).toHaveLength(1);
    expect(bBefore).toHaveLength(1);

    const res = await deleteFriend(a.id, b.id);
    expect(res.statusCode).toBe(204);

    const aAfter = await getFriends(a.id);
    const bAfter = await getFriends(b.id);
    expect(aAfter).toEqual([]);
    expect(bAfter).toEqual([]);
  });

  it('a 404 (no friendship row) does NOT bump — the pre-existing cache entry is untouched/reused', async () => {
    const a = await createUser('del404-a');
    const realFriend = await createUser('del404-real-friend');
    const strangerId = await createUser('del404-stranger');
    await makeFriends(a.id, realFriend.id);

    const before = await getFriends(a.id);
    expect(before).toHaveLength(1);
    const genBefore = userGeneration(a.id);

    // Mutate the underlying friendship set DIRECTLY (bypassing every bump
    // site) so a real recompute would differ from `before`.
    const extraFriend = await createUser('del404-extra-friend');
    await makeFriends(a.id, extraFriend.id);

    const res = await deleteFriend(a.id, strangerId.id); // never friended -> 404
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('FRIENDSHIP_NOT_FOUND');

    expect(userGeneration(a.id)).toBe(genBefore); // not bumped

    const after = await getFriends(a.id);
    expect(after).toEqual(before); // still the stale (pre-mutation) cached value — proves no bump occurred
  });

  it('a 409 (outstanding balance) does NOT bump — the pre-existing cache entry is untouched/reused', async () => {
    const a = await createUser('del409-a');
    const b = await createUser('del409-b');
    await makeFriends(a.id, b.id);
    await createSplitExpense(a.id, b.id, 5000); // b owes a 2500 — NOT settled

    const aBefore = await getFriends(a.id);
    const bBefore = await getFriends(b.id);
    expect(aBefore).toHaveLength(1);
    expect(bBefore).toHaveLength(1);
    const genABefore = userGeneration(a.id);
    const genBBefore = userGeneration(b.id);

    const res = await deleteFriend(a.id, b.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('OUTSTANDING_BALANCE');

    expect(userGeneration(a.id)).toBe(genABefore);
    expect(userGeneration(b.id)).toBe(genBBefore);

    const aAfter = await getFriends(a.id);
    const bAfter = await getFriends(b.id);
    expect(aAfter).toEqual(aBefore);
    expect(bAfter).toEqual(bBefore);
  });
});
