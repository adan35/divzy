// spec-WI-067.md §4 (COMPLETE bump-site enumeration) + ADR-030 sign-off
// condition C3 ("each enumerated site has a test asserting the affected
// users' generation advanced; the actor-only-vs-both-parties cases are
// explicitly covered") + the CEO gate ruling folding in §4.5 sites C1/C2 as
// REQUIRED.
//
// Real-DB integration, mirroring this domain's established convention
// (wi054b-settlement-restore.test.ts): real users/groups/expenses/
// settlements seeded via `prisma`, driven end-to-end through `app.inject`
// against the real routes/services, with `userGeneration()` read directly
// (same process) to prove exactly which users were bumped and — just as
// important — which were NOT.
//
// TDD: written directly from the spec's §4 table BEFORE any bump call site
// existed anywhere in expense-service.ts/settlements.ts/groups.ts/
// analytics.ts/users.ts — every one of these was red (generation unchanged)
// prior to adding its one-liner.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../src/lib/prisma';
import { userGeneration } from '../src/lib/cache';
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
      email: `wi067-bump-${label}-${STAMP}-${Math.random().toString(36).slice(2, 8)}@test.local`,
      passwordHash: 'not-a-real-hash',
      name: `WI-067 Bump ${label}`,
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

/** Snapshot every candidate user's current generation before an action. */
function snapshot(ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = userGeneration(id);
  return out;
}

/** Assert exactly `bumped` advanced (by >=1) and every other candidate id did not move at all. */
function expectExactBumpSet(
  before: Record<string, number>,
  candidateIds: string[],
  bumpedIds: string[],
) {
  const bumpedSet = new Set(bumpedIds);
  for (const id of candidateIds) {
    const delta = userGeneration(id) - before[id];
    if (bumpedSet.has(id)) {
      expect(delta, `expected ${id} to be bumped`).toBeGreaterThanOrEqual(1);
    } else {
      expect(delta, `expected ${id} NOT to be bumped`).toBe(0);
    }
  }
}

async function createGroupDirect(
  creatorId: string,
  members: Array<{ userId: string; role: 'ADMIN' | 'MEMBER'; leftAt?: Date | null }>,
) {
  groupCounter += 1;
  const group = await prisma.group.create({
    data: {
      name: 'WI-067 Bump Fixture',
      inviteCode: `WI067-BUMP-${STAMP}-${groupCounter}`,
      createdById: creatorId,
      members: {
        create: members.map((m) => ({
          userId: m.userId,
          role: m.role,
          ...(m.leftAt !== undefined ? { leftAt: m.leftAt } : {}),
        })),
      },
    },
  });
  allGroupIds.push(group.id);
  return group.id;
}

async function createExpenseViaRoute(
  actorId: string,
  opts: { groupId?: string | null; participantIds: string[]; payerId?: string; amount?: number },
) {
  const amount = opts.amount ?? 1000;
  const payerId = opts.payerId ?? actorId;
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/expenses',
    headers: authHeaders(actorId),
    payload: {
      groupId: opts.groupId ?? null,
      description: 'WI-067 bump-site expense',
      amount,
      currency: 'USD',
      category: 'OTHER',
      date: new Date().toISOString(),
      splitType: 'EQUAL',
      payers: [{ userId: payerId, amount }],
      participants: opts.participantIds.map((userId) => ({ userId })),
    },
  });
  expect(res.statusCode).toBe(201);
  const id = res.json().id as string;
  allExpenseIds.push(id);
  return id;
}

async function updateExpenseViaRoute(
  actorId: string,
  expenseId: string,
  opts: { participantIds: string[]; payerId?: string; amount?: number },
) {
  const amount = opts.amount ?? 1000;
  const payerId = opts.payerId ?? opts.participantIds[0]!;
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/v1/expenses/${expenseId}`,
    headers: authHeaders(actorId),
    payload: {
      description: 'WI-067 bump-site expense (updated)',
      amount,
      currency: 'USD',
      category: 'OTHER',
      date: new Date().toISOString(),
      splitType: 'EQUAL',
      payers: [{ userId: payerId, amount }],
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
  return res.json();
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await prisma.expenseSplit.deleteMany({ where: { expenseId: { in: allExpenseIds } } });
  await prisma.expensePayer.deleteMany({ where: { expenseId: { in: allExpenseIds } } });
  await prisma.expenseRevision.deleteMany({ where: { expenseId: { in: allExpenseIds } } });
  await prisma.expense.deleteMany({ where: { id: { in: allExpenseIds } } });
  await prisma.settlement.deleteMany({ where: { id: { in: allSettlementIds } } });
  await prisma.groupMember.deleteMany({ where: { groupId: { in: allGroupIds } } });
  await prisma.group.deleteMany({ where: { id: { in: allGroupIds } } });
  await prisma.friendship.deleteMany({
    where: { OR: [{ userAId: { in: allUserIds } }, { userBId: { in: allUserIds } }] },
  });
  await prisma.manualExchangeRate.deleteMany({ where: { userId: { in: allUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: allUserIds } } });
  await app.close();
});

// ---------------------------------------------------------------------------
// E1-E4 — expenses (service layer, expense-service.ts)
// ---------------------------------------------------------------------------
describe('E1 — createExpense bumps payers + participants, not just the actor', () => {
  it('a non-group expense created by A with participant B bumps BOTH, not only A', async () => {
    const a = await createUser('e1-a');
    const b = await createUser('e1-b');
    const before = snapshot([a, b]);

    await createExpenseViaRoute(a, { participantIds: [a, b] });

    expectExactBumpSet(before, [a, b], [a, b]);
  });
});

describe('E2 — updateExpense bumps the UNION of OLD and NEW participants', () => {
  it('removing B and adding C still bumps B (the removed one), not just A and C', async () => {
    const a = await createUser('e2-a');
    const b = await createUser('e2-b');
    const c = await createUser('e2-c');
    const expenseId = await createExpenseViaRoute(a, { participantIds: [a, b] });

    const before = snapshot([a, b, c]);
    await updateExpenseViaRoute(a, expenseId, { participantIds: [a, c] });

    expectExactBumpSet(before, [a, b, c], [a, b, c]); // union, not just the new set
  });
});

describe('E3 — deleteExpense bumps payers + splits', () => {
  it('deleting a 2-person expense bumps both', async () => {
    const a = await createUser('e3-a');
    const b = await createUser('e3-b');
    const expenseId = await createExpenseViaRoute(a, { participantIds: [a, b] });

    const before = snapshot([a, b]);
    await deleteExpenseViaRoute(a, expenseId);

    expectExactBumpSet(before, [a, b], [a, b]);
  });
});

describe('E4 — restoreExpense bumps payers + splits, idempotent no-op bumps nobody', () => {
  it('restoring a deleted expense bumps both payer and participant', async () => {
    const a = await createUser('e4-a');
    const b = await createUser('e4-b');
    const expenseId = await createExpenseViaRoute(a, { participantIds: [a, b] });
    await deleteExpenseViaRoute(a, expenseId);

    const before = snapshot([a, b]);
    await restoreExpenseViaRoute(a, expenseId);

    expectExactBumpSet(before, [a, b], [a, b]);
  });

  it('restoring an ALREADY-ACTIVE expense (idempotent no-op) bumps nobody', async () => {
    const a = await createUser('e4-noop-a');
    const b = await createUser('e4-noop-b');
    const expenseId = await createExpenseViaRoute(a, { participantIds: [a, b] });
    // Never deleted — already active.

    const before = snapshot([a, b]);
    await restoreExpenseViaRoute(a, expenseId);

    expectExactBumpSet(before, [a, b], []);
  });
});

// ---------------------------------------------------------------------------
// S1-S3 — settlements (route layer, settlements.ts)
// ---------------------------------------------------------------------------
describe('S1 — POST /settlements bumps BOTH parties, not just the actor', () => {
  it('B (payer) recording a settlement to A also bumps A, the non-actor recipient', async () => {
    const a = await createUser('s1-a');
    const b = await createUser('s1-b');
    // B owes A 500 (A paid 1000, split evenly).
    await createExpenseViaRoute(a, { participantIds: [a, b], payerId: a, amount: 1000 });

    const before = snapshot([a, b]);
    await createSettlementViaRoute(b, { fromUserId: b, toUserId: a, amount: 300 });

    expectExactBumpSet(before, [a, b], [a, b]);
  });
});

describe('S2 — DELETE /settlements bumps both parties (route-level bumpUsers), plus every active group member gets bumped too via recordActivity (WI-073)', () => {
  it('an admin (not a party) deleting a group settlement bumps the two parties AND every other active member (creator, admin) via recordActivitys own bumpUsers(recipientIds)', async () => {
    const from = await createUser('s2-from');
    const to = await createUser('s2-to');
    const creator = await createUser('s2-creator');
    const admin = await createUser('s2-admin');
    const groupId = await createGroupDirect(admin, [
      { userId: from, role: 'MEMBER' },
      { userId: to, role: 'MEMBER' },
      { userId: creator, role: 'MEMBER' },
      { userId: admin, role: 'ADMIN' },
    ]);
    const settlement = await prisma.settlement.create({
      data: {
        groupId,
        fromUserId: from,
        toUserId: to,
        amount: 200,
        currency: 'USD',
        method: 'CASH',
        date: new Date(),
        createdById: creator,
      },
    });
    allSettlementIds.push(settlement.id);

    const before = snapshot([from, to, creator, admin]);
    await deleteSettlementViaRoute(admin, settlement.id);

    // WI-073: recordActivity now calls bumpUsers(recipientIds) itself
    // (spec-WI-073 §3), and for a GROUP settlement DELETE, this route's own
    // recipientIds computation (routes/settlements.ts DELETE handler) is
    // EVERY active group member plus both parties -- not just the two
    // parties the route's separate, narrower `bumpUsers([from, to])` call
    // (WI-067 site S2) targets. `creator` and `admin` are both active
    // members (leftAt: null) of this fixture's group, so they are now
    // correctly bumped too: recordActivity's recipientIds is, by
    // definition, exactly the set of users whose GET /activity result just
    // changed, and every one of them needs their (now-cached) GET /activity
    // invalidated. This is a foreseeable, safe widening (over-invalidation
    // is never staleness, only an extra cache miss for admin/creator's
    // shared per-user balance/analytics cache entries too) -- confirmed by
    // independent re-read of settlements.ts, not just Build's flag.
    expectExactBumpSet(before, [from, to, creator, admin], [from, to, creator, admin]);
  });
});

describe('S3 — POST /settlements/:id/restore bumps both parties; idempotent no-op bumps nobody', () => {
  it('restoring a deleted settlement bumps both parties AND every other active member (admin) via recordActivitys own bumpUsers(recipientIds) (WI-073)', async () => {
    const from = await createUser('s3-from');
    const to = await createUser('s3-to');
    const admin = await createUser('s3-admin');
    const groupId = await createGroupDirect(admin, [
      { userId: from, role: 'MEMBER' },
      { userId: to, role: 'MEMBER' },
      { userId: admin, role: 'ADMIN' },
    ]);
    const settlement = await prisma.settlement.create({
      data: {
        groupId,
        fromUserId: from,
        toUserId: to,
        amount: 150,
        currency: 'USD',
        method: 'CASH',
        date: new Date(),
        createdById: from,
        deletedAt: new Date(),
      },
    });
    allSettlementIds.push(settlement.id);

    const before = snapshot([from, to, admin]);
    await restoreSettlementViaRoute(admin, settlement.id);

    // WI-073: same widening as S2 above -- recordActivity's own
    // bumpUsers(recipientIds) now also bumps `admin`, who is an active
    // member of this fixture's group (not just `from`/`to`, the two parties
    // the route's own narrower bumpUsers([from, to]) call targets).
    expectExactBumpSet(before, [from, to, admin], [from, to, admin]);
  });

  it('restoring an ALREADY-ACTIVE settlement (idempotent no-op) bumps nobody', async () => {
    const from = await createUser('s3-noop-from');
    const to = await createUser('s3-noop-to');
    const settlement = await prisma.settlement.create({
      data: {
        fromUserId: from,
        toUserId: to,
        amount: 100,
        currency: 'USD',
        method: 'CASH',
        date: new Date(),
        createdById: from,
      },
    });
    allSettlementIds.push(settlement.id);

    const before = snapshot([from, to]);
    await restoreSettlementViaRoute(from, settlement.id);

    expectExactBumpSet(before, [from, to], []);
  });
});

// ---------------------------------------------------------------------------
// G1-G7 — social-groups (route layer, groups.ts)
// ---------------------------------------------------------------------------
describe('G1 — POST /groups/join bumps the joiner + active members, not a left member', () => {
  it('joining by code bumps the joiner and the existing active admin, not someone who already left', async () => {
    const admin = await createUser('g1-admin');
    const leftMember = await createUser('g1-left');
    const joiner = await createUser('g1-joiner');
    const groupId = await createGroupDirect(admin, [
      { userId: admin, role: 'ADMIN' },
      { userId: leftMember, role: 'MEMBER', leftAt: new Date() },
    ]);
    const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });

    const before = snapshot([admin, leftMember, joiner]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/groups/join',
      headers: authHeaders(joiner),
      payload: { code: group.inviteCode },
    });
    expect(res.statusCode).toBe(200);

    expectExactBumpSet(before, [admin, leftMember, joiner], [admin, joiner]);
  });
});

describe('G2 — POST /groups/:groupId/members bumps the target + active members', () => {
  it('adding an existing user by email bumps the target and the existing active member', async () => {
    const admin = await createUser('g2-admin');
    const member = await createUser('g2-member');
    const target = await createUser('g2-target');
    const groupId = await createGroupDirect(admin, [
      { userId: admin, role: 'ADMIN' },
      { userId: member, role: 'MEMBER' },
    ]);
    const targetUser = await prisma.user.findUniqueOrThrow({ where: { id: target } });

    const before = snapshot([admin, member, target]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${groupId}/members`,
      headers: authHeaders(admin),
      payload: { email: targetUser.email },
    });
    expect(res.statusCode).toBe(200);

    expectExactBumpSet(before, [admin, member, target], [admin, member, target]);
  });
});

describe('G3 — POST /groups/:groupId/members/by-friend bumps the target + active members', () => {
  it('adding an existing friend bumps the target and the existing active member', async () => {
    const admin = await createUser('g3-admin');
    const member = await createUser('g3-member');
    const friend = await createUser('g3-friend');
    const groupId = await createGroupDirect(admin, [
      { userId: admin, role: 'ADMIN' },
      { userId: member, role: 'MEMBER' },
    ]);
    const [userAId, userBId] = admin < friend ? [admin, friend] : [friend, admin];
    await prisma.friendship.create({ data: { userAId, userBId } });

    const before = snapshot([admin, member, friend]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${groupId}/members/by-friend`,
      headers: authHeaders(admin),
      payload: { userId: friend },
    });
    expect(res.statusCode).toBe(200);

    expectExactBumpSet(before, [admin, member, friend], [admin, member, friend]);
  });
});

describe('G4 — removeMemberFlow bumps target + remaining, shared by BOTH remove and leave routes', () => {
  it('DELETE /groups/:groupId/members/:userId (admin removes) bumps the target and the remaining member', async () => {
    const admin = await createUser('g4-remove-admin');
    const target = await createUser('g4-remove-target');
    const bystander = await createUser('g4-remove-bystander');
    const groupId = await createGroupDirect(admin, [
      { userId: admin, role: 'ADMIN' },
      { userId: target, role: 'MEMBER' },
      { userId: bystander, role: 'MEMBER' },
    ]);

    const before = snapshot([admin, target, bystander]);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/groups/${groupId}/members/${target}`,
      headers: authHeaders(admin),
    });
    expect(res.statusCode).toBe(200);

    expectExactBumpSet(before, [admin, target, bystander], [target, admin, bystander]);
  });

  it('POST /groups/:groupId/leave (self-leave) bumps the leaver and the remaining member — same shared flow', async () => {
    const admin = await createUser('g4-leave-admin');
    const leaver = await createUser('g4-leave-self');
    const bystander = await createUser('g4-leave-bystander');
    const groupId = await createGroupDirect(admin, [
      { userId: admin, role: 'ADMIN' },
      { userId: leaver, role: 'MEMBER' },
      { userId: bystander, role: 'MEMBER' },
    ]);

    const before = snapshot([admin, leaver, bystander]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${groupId}/leave`,
      headers: authHeaders(leaver),
    });
    expect(res.statusCode).toBe(204);

    expectExactBumpSet(before, [admin, leaver, bystander], [leaver, admin, bystander]);
  });
});

describe('G5 — POST /groups/:groupId/delete (terminal) bumps every formerly-active member', () => {
  it('deleting a settled group bumps both members', async () => {
    const admin = await createUser('g5-admin');
    const member = await createUser('g5-member');
    const groupId = await createGroupDirect(admin, [
      { userId: admin, role: 'ADMIN' },
      { userId: member, role: 'MEMBER' },
    ]);

    const before = snapshot([admin, member]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${groupId}/delete`,
      headers: authHeaders(admin),
    });
    expect(res.statusCode).toBe(204);

    expectExactBumpSet(before, [admin, member], [admin, member]);
  });
});

describe('G6 — POST /groups/:groupId/unarchive bumps active members; idempotent no-op bumps nobody', () => {
  it('unarchiving a genuinely-archived group bumps the active members', async () => {
    const admin = await createUser('g6-admin');
    const member = await createUser('g6-member');
    const groupId = await createGroupDirect(admin, [
      { userId: admin, role: 'ADMIN' },
      { userId: member, role: 'MEMBER' },
    ]);
    await prisma.group.update({ where: { id: groupId }, data: { archivedAt: new Date() } });

    const before = snapshot([admin, member]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${groupId}/unarchive`,
      headers: authHeaders(admin),
    });
    expect(res.statusCode).toBe(200);

    expectExactBumpSet(before, [admin, member], [admin, member]);
  });

  it('unarchiving an already-active group (idempotent no-op) bumps nobody', async () => {
    const admin = await createUser('g6-noop-admin');
    const member = await createUser('g6-noop-member');
    const groupId = await createGroupDirect(admin, [
      { userId: admin, role: 'ADMIN' },
      { userId: member, role: 'MEMBER' },
    ]);
    // Never archived.

    const before = snapshot([admin, member]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${groupId}/unarchive`,
      headers: authHeaders(admin),
    });
    expect(res.statusCode).toBe(200);

    expectExactBumpSet(before, [admin, member], []);
  });
});

describe('G7 — DELETE /groups/:groupId (archive) bumps active members', () => {
  it('archiving a group bumps its active members', async () => {
    const admin = await createUser('g7-admin');
    const member = await createUser('g7-member');
    const groupId = await createGroupDirect(admin, [
      { userId: admin, role: 'ADMIN' },
      { userId: member, role: 'MEMBER' },
    ]);

    const before = snapshot([admin, member]);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/groups/${groupId}`,
      headers: authHeaders(admin),
    });
    expect(res.statusCode).toBe(204);

    expectExactBumpSet(before, [admin, member], [admin, member]);
  });
});

// ---------------------------------------------------------------------------
// C1-C2 — conversion-affecting writes (CEO gate ruling: REQUIRED, not optional)
// ---------------------------------------------------------------------------
describe('C1 — PATCH /users/me bumps the caller ONLY when defaultCurrency actually changes', () => {
  it('changing defaultCurrency from USD to EUR bumps the caller', async () => {
    const user = await createUser('c1-change');
    const before = snapshot([user]);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: authHeaders(user),
      payload: { defaultCurrency: 'EUR' },
    });
    expect(res.statusCode).toBe(200);

    expectExactBumpSet(before, [user], [user]);
  });

  it('PATCHing defaultCurrency to its CURRENT value does not bump (no actual change)', async () => {
    const user = await createUser('c1-same');
    // Default is USD already (schema default).
    const before = snapshot([user]);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: authHeaders(user),
      payload: { defaultCurrency: 'USD' },
    });
    expect(res.statusCode).toBe(200);

    expectExactBumpSet(before, [user], []);
  });

  it('PATCHing a field other than defaultCurrency does not bump', async () => {
    const user = await createUser('c1-other-field');
    const before = snapshot([user]);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: authHeaders(user),
      payload: { name: 'Renamed WI-067 User' },
    });
    expect(res.statusCode).toBe(200);

    expectExactBumpSet(before, [user], []);
  });
});

describe('C2 — POST /rates/manual ALWAYS bumps the caller', () => {
  it('storing a new manual rate bumps the caller', async () => {
    const user = await createUser('c2-new');
    const before = snapshot([user]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rates/manual',
      headers: authHeaders(user),
      payload: { from: 'USD', to: 'EUR', rate: 0.9 },
    });
    expect(res.statusCode).toBe(200);

    expectExactBumpSet(before, [user], [user]);
  });

  it('resubmitting (upserting) the same pair still bumps the caller — always, not just on change', async () => {
    const user = await createUser('c2-resubmit');
    await app.inject({
      method: 'POST',
      url: '/api/v1/rates/manual',
      headers: authHeaders(user),
      payload: { from: 'USD', to: 'EUR', rate: 0.9 },
    });

    const before = snapshot([user]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rates/manual',
      headers: authHeaders(user),
      payload: { from: 'USD', to: 'EUR', rate: 0.9 }, // identical rate, still an upsert
    });
    expect(res.statusCode).toBe(200);

    expectExactBumpSet(before, [user], [user]);
  });
});
