import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

// WI-032 (expenses) — GET /expenses/used-categories?groupId=<id>: a cheap,
// read-only, distinct-non-deleted-category aggregate scoped to a group.
// Deliberately NOT mocking '../src/lib/prisma' — this exercises the real
// Prisma groupBy DISTINCT against actual Expense rows (including a
// soft-deleted-only category), the same real-DB technique as
// expense-history.test.ts.
//
// Spec: .company/domains/expenses/specs/spec-WI-032.md

import { prisma } from '../src/lib/prisma';
import { buildApp } from '../src/app';

let app: FastifyInstance;
let memberId: string;
let nonMemberId: string;
let tokenMember: string;
let tokenNonMember: string;
let groupId: string;
let emptyGroupId: string;
const STAMP = Date.now();

async function createTestUser(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `wi032-${label}-${STAMP}@test.local`,
      passwordHash: 'not-a-real-hash',
      name: `WI-032 Test ${label}`,
    },
  });
  return user.id;
}

beforeAll(async () => {
  memberId = await createTestUser('member');
  nonMemberId = await createTestUser('nonmember');

  const group = await prisma.group.create({
    data: {
      name: 'WI-032 Test Group',
      inviteCode: `wi032-${STAMP}`,
      createdById: memberId,
      members: { create: [{ userId: memberId, role: 'ADMIN' }] },
    },
  });
  groupId = group.id;

  const emptyGroup = await prisma.group.create({
    data: {
      name: 'WI-032 Empty Test Group',
      inviteCode: `wi032-empty-${STAMP}`,
      createdById: memberId,
      members: { create: [{ userId: memberId, role: 'ADMIN' }] },
    },
  });
  emptyGroupId = emptyGroup.id;

  function baseExpense(overrides: Record<string, unknown> = {}) {
    return {
      groupId,
      description: 'WI-032 fixture',
      amount: 1000,
      currency: 'USD',
      date: new Date('2026-07-10T00:00:00.000Z'),
      splitType: 'EQUAL' as const,
      createdById: memberId,
      ...overrides,
    };
  }

  // Two non-deleted expenses sharing FOOD_DRINK (DISTINCT must collapse
  // them into one entry), one non-deleted HOME, and one soft-deleted-only
  // GIFTS (must be excluded entirely).
  await prisma.expense.createMany({
    data: [
      baseExpense({ category: 'FOOD_DRINK' }),
      baseExpense({ category: 'FOOD_DRINK' }),
      baseExpense({ category: 'HOME' }),
      baseExpense({ category: 'GIFTS', deletedAt: new Date() }),
    ],
  });

  app = await buildApp();
  await app.ready();
  tokenMember = app.jwt.sign({ sub: memberId });
  tokenNonMember = app.jwt.sign({ sub: nonMemberId });
});

afterAll(async () => {
  await app?.close();
  await prisma.expense.deleteMany({ where: { groupId: { in: [groupId, emptyGroupId] } } });
  await prisma.groupMember.deleteMany({ where: { groupId: { in: [groupId, emptyGroupId] } } });
  await prisma.group.deleteMany({ where: { id: { in: [groupId, emptyGroupId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [memberId, nonMemberId] } } });
  await prisma.$disconnect();
});

async function getUsedCategories(qGroupId: string | undefined, token = tokenMember) {
  return app.inject({
    method: 'GET',
    url: qGroupId === undefined ? '/api/v1/expenses/used-categories' : `/api/v1/expenses/used-categories?groupId=${qGroupId}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe('GET /expenses/used-categories', () => {
  it('requires authentication', async () => {
    const res = await getUsedCategories(groupId, '');
    expect(res.statusCode).toBe(401);
  });

  it('returns the distinct non-deleted categories used in the group, excluding a soft-deleted-only category', async () => {
    const res = await getUsedCategories(groupId);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.categories).toHaveLength(2);
    expect(new Set(body.categories)).toEqual(new Set(['FOOD_DRINK', 'HOME']));
    expect(body.categories).not.toContain('GIFTS');
  });

  it('404s for a caller who is not an active member of the group (no existence leak)', async () => {
    const res = await getUsedCategories(groupId, tokenNonMember);
    expect(res.statusCode).toBe(404);
  });

  it('returns an empty array (not an error) for a group with zero non-deleted expenses', async () => {
    const res = await getUsedCategories(emptyGroupId);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ categories: [] });
  });

  it('200s (unscoped, WI-064) when groupId is missing', async () => {
    const res = await getUsedCategories(undefined);
    expect(res.statusCode).toBe(200);
  });

  it('400s when groupId fails the shared id-shape validation', async () => {
    const res = await getUsedCategories('short');
    expect(res.statusCode).toBe(400);
  });
});
