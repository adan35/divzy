// spec-WI-073 §2/§3/§5/§7 — GET /activity read-through cache (8s TTL) +
// bumpUsers wired into recordActivity's fan-out.
//
// Real-DB integration, mirroring this domain's established convention
// (wi067-bump-sites.test.ts / wi054b-settlement-restore.test.ts): real
// users/expenses seeded via `prisma`, driven end-to-end through `app.inject`
// against the real routes/services — not a hand-rolled in-memory prisma
// mock, so a cache hit is proven by directly mutating the underlying DB
// behind the cache's back (bypassing recordActivity's bump) and asserting
// the next GET /activity response is UNCHANGED — a real fresh query would
// see the mutated DB state, so an unchanged response can only mean the
// route served a cached value.
//
// Covers the four scenarios the story/spec explicitly mandate (spec §7):
//   (a) cache hit within TTL — served without re-querying
//   (b) invalidation via bump, not TTL expiry
//   (c) cross-viewer cache isolation (no leak; A's bump never affects B)
//   (d) sendSystemNotification does not bump / does not affect a cached
//       GET /activity response
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../src/lib/prisma';
import { resetCacheForTests, userGeneration } from '../src/lib/cache';
import { sendSystemNotification } from '../src/lib/activity';
import { buildApp } from '../src/app';

const STAMP = Date.now();
let app: FastifyInstance;

const allUserIds: string[] = [];
const allExpenseIds: string[] = [];

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `wi073-cache-${label}-${STAMP}-${Math.random().toString(36).slice(2, 8)}@test.local`,
      passwordHash: 'not-a-real-hash',
      name: `WI-073 Cache ${label}`,
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

/** Non-group expense between exactly the given participants (equal split). */
async function createExpenseViaRoute(actorId: string, participantIds: string[]) {
  const amount = 1000;
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/expenses',
    headers: authHeaders(actorId),
    payload: {
      groupId: null,
      description: 'WI-073 cache-test expense',
      amount,
      currency: 'USD',
      category: 'OTHER',
      date: new Date().toISOString(),
      splitType: 'EQUAL',
      payers: [{ userId: actorId, amount }],
      participants: participantIds.map((userId) => ({ userId })),
    },
  });
  expect(res.statusCode).toBe(201);
  const id = res.json().id as string;
  allExpenseIds.push(id);
  return id;
}

async function getActivity(asUserId: string) {
  return app.inject({
    method: 'GET',
    url: '/api/v1/activity',
    headers: authHeaders(asUserId),
  });
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

beforeEach(() => {
  // Process-wide LRU singletons (cache.ts) — start every test from a cold
  // cache/generation state so earlier tests' entries can never leak in.
  resetCacheForTests();
});

afterAll(async () => {
  await prisma.expenseSplit.deleteMany({ where: { expenseId: { in: allExpenseIds } } });
  await prisma.expensePayer.deleteMany({ where: { expenseId: { in: allExpenseIds } } });
  await prisma.expenseRevision.deleteMany({ where: { expenseId: { in: allExpenseIds } } });
  await prisma.expense.deleteMany({ where: { id: { in: allExpenseIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: allUserIds } } });
  await prisma.activityLog.deleteMany({ where: { actorId: { in: allUserIds } } });
  await prisma.friendship.deleteMany({
    where: { OR: [{ userAId: { in: allUserIds } }, { userBId: { in: allUserIds } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: allUserIds } } });
  await app.close();
});

describe('WI-073 (a) — cache hit within the 8s TTL window is served without re-querying', () => {
  it('a second immediate call returns byte-identical content even after the underlying rows are deleted directly', async () => {
    const a = await createUser('a-viewer');
    const b = await createUser('a-counterpart');
    await createExpenseViaRoute(a, [a, b]);

    const first = await getActivity(a);
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.items.length).toBeGreaterThan(0);

    // Delete the underlying ActivityLog rows directly via prisma (bypassing
    // the app entirely, so recordActivity's bumpUsers never fires). If the
    // second GET /activity were a real DB query it would now see 0 items.
    await prisma.activityLog.deleteMany({ where: { actorId: a } });

    const second = await getActivity(a);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(firstBody);
  });
});

describe('WI-073 (b) — a new activity item is visible on the very next call via bump-invalidation, not TTL expiry', () => {
  it('recordActivity for a new expense is reflected immediately, well inside the 8s TTL window', async () => {
    const a = await createUser('b-viewer');
    const b = await createUser('b-counterpart');

    const before = await getActivity(a);
    expect(before.statusCode).toBe(200);
    const beforeCount = before.json().items.length;

    const expenseId = await createExpenseViaRoute(a, [a, b]);

    const after = await getActivity(a);
    expect(after.statusCode).toBe(200);
    const afterItems = after.json().items;
    expect(afterItems.length).toBe(beforeCount + 1);
    expect(afterItems.some((i: { expenseId: string | null }) => i.expenseId === expenseId)).toBe(
      true,
    );
  });
});

describe('WI-073 (c) — two viewers cached GET /activity pages never cross-leak', () => {
  it('A and B each see only their own recipient rows, and bumping A never affects Bs distinct cached entry', async () => {
    const a = await createUser('c-a');
    const c = await createUser('c-a-counterpart');
    const b = await createUser('c-b');
    const d = await createUser('c-b-counterpart');

    const aExpenseId = await createExpenseViaRoute(a, [a, c]);
    const bExpenseId = await createExpenseViaRoute(b, [b, d]);

    const aRes = await getActivity(a); // identical query params (none) as B
    const bRes = await getActivity(b);
    expect(aRes.statusCode).toBe(200);
    expect(bRes.statusCode).toBe(200);

    const aItems = aRes.json().items;
    const bItems = bRes.json().items;
    expect(aItems.some((i: { expenseId: string | null }) => i.expenseId === aExpenseId)).toBe(
      true,
    );
    expect(aItems.some((i: { expenseId: string | null }) => i.expenseId === bExpenseId)).toBe(
      false,
    );
    expect(bItems.some((i: { expenseId: string | null }) => i.expenseId === bExpenseId)).toBe(
      true,
    );
    expect(bItems.some((i: { expenseId: string | null }) => i.expenseId === aExpenseId)).toBe(
      false,
    );

    // Bump A's generation via a brand-new mutation for A only.
    await createExpenseViaRoute(a, [a, c]);

    // Prove B's cache entry is untouched by A's bump: delete B's underlying
    // rows directly, then confirm GET /activity for B still returns the
    // exact pre-deletion cached response. If A's bump had touched B's
    // generation too, cacheKey(...) for B would differ and this would be a
    // fresh (now-empty) query instead of the stale-but-correct cache hit.
    await prisma.activityLog.deleteMany({ where: { actorId: b } });
    const bResAfter = await getActivity(b);
    expect(bResAfter.json()).toEqual(bRes.json());
  });
});

describe('WI-073 (d) — sendSystemNotification never bumps or affects the activity cache', () => {
  it('a cached GET /activity response is unchanged, and the generation counter unmoved, across an intervening sendSystemNotification call', async () => {
    const a = await createUser('d-a');
    const b = await createUser('d-b');
    await createExpenseViaRoute(a, [a, b]);

    const before = await getActivity(a);
    expect(before.statusCode).toBe(200);
    const genBefore = userGeneration(a);

    await sendSystemNotification({
      userId: a,
      type: 'BALANCE_REMINDER',
      title: 'You have a stale balance',
      body: 'Settle up',
      data: {},
    });

    // Determination under test (spec §5): sendSystemNotification must NOT
    // advance the caller's activity-cache generation.
    expect(userGeneration(a)).toBe(genBefore);

    // Delete the underlying rows directly to prove the SECOND GET /activity
    // call is still served from the SAME cache entry (a true hit) rather
    // than "happens to match because nothing changed".
    await prisma.activityLog.deleteMany({ where: { actorId: a } });
    const after = await getActivity(a);
    expect(after.json()).toEqual(before.json());
  });
});
