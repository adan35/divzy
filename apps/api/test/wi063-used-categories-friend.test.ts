import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

// WI-063 (expenses) — GET /expenses/used-categories?friendId=<id>: extends
// WI-032's group-scoped aggregate to a friend scope, mirroring the double
// involvementFilter gate GET /expenses?friendId= already uses. Deliberately
// NOT mocking '../src/lib/prisma' — real Prisma groupBy DISTINCT against
// actual Expense/ExpensePayer/ExpenseSplit rows, same technique as
// wi032-used-categories.test.ts.
//
// Spec: .company/domains/expenses/specs/spec-WI-063.md §3.1/§3.2

import { prisma } from '../src/lib/prisma';
import { buildApp } from '../src/app';

let app: FastifyInstance;
let viewerId: string;
let friendId: string;
let strangerId: string; // shares no expenses with viewer — used for the empty-array-not-404 check
let tokenViewer: string;
const STAMP = Date.now();

async function createTestUser(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `wi063-${label}-${STAMP}@test.local`,
      passwordHash: 'not-a-real-hash',
      name: `WI-063 Test ${label}`,
    },
  });
  return user.id;
}

/** Non-group expense between viewer and friend, with payers/splits so involvementFilter matches both. */
async function createSharedExpense(overrides: Record<string, unknown> = {}) {
  return prisma.expense.create({
    data: {
      description: 'WI-063 fixture',
      amount: 1000,
      currency: 'USD',
      date: new Date('2026-07-10T00:00:00.000Z'),
      splitType: 'EQUAL',
      createdById: viewerId,
      payers: { create: [{ userId: viewerId, amount: 1000 }] },
      splits: { create: [{ userId: viewerId, amount: 500 }, { userId: friendId, amount: 500 }] },
      ...overrides,
    },
  });
}

beforeAll(async () => {
  viewerId = await createTestUser('viewer');
  friendId = await createTestUser('friend');
  strangerId = await createTestUser('stranger');

  // Two non-deleted expenses sharing FOOD_DRINK (DISTINCT must collapse them
  // into one entry), one non-deleted HOME, and one soft-deleted-only GIFTS
  // (must be excluded entirely) — same coverage shape as wi032's group test.
  await createSharedExpense({ category: 'FOOD_DRINK' });
  await createSharedExpense({ category: 'FOOD_DRINK' });
  await createSharedExpense({ category: 'HOME' });
  await createSharedExpense({ category: 'GIFTS', deletedAt: new Date() });

  app = await buildApp();
  await app.ready();
  tokenViewer = app.jwt.sign({ sub: viewerId });
});

afterAll(async () => {
  await app?.close();
  await prisma.expense.deleteMany({ where: { createdById: viewerId } });
  await prisma.user.deleteMany({ where: { id: { in: [viewerId, friendId, strangerId] } } });
  await prisma.$disconnect();
});

async function getUsedCategories(query: string, token = tokenViewer) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/expenses/used-categories?${query}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe('GET /expenses/used-categories?friendId= (WI-063)', () => {
  it('returns the distinct non-deleted categories shared with the friend, excluding a soft-deleted-only category', async () => {
    const res = await getUsedCategories(`friendId=${friendId}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.categories).toHaveLength(2);
    expect(new Set(body.categories)).toEqual(new Set(['FOOD_DRINK', 'HOME']));
    expect(body.categories).not.toContain('GIFTS');
  });

  it('returns an empty array (not an error) for a friendId with zero shared expenses (no existence leak)', async () => {
    const res = await getUsedCategories(`friendId=${strangerId}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ categories: [] });
  });

  it('400s when both groupId and friendId are provided', async () => {
    const res = await getUsedCategories(`groupId=someGroupId1&friendId=${friendId}`);
    expect(res.statusCode).toBe(400);
  });

  it('200s when neither groupId nor friendId is provided (WI-064 unscoped)', async () => {
    const res = await getUsedCategories('');
    expect(res.statusCode).toBe(200);
  });

  it('requires authentication', async () => {
    const res = await getUsedCategories(`friendId=${friendId}`, '');
    expect(res.statusCode).toBe(401);
  });
});
