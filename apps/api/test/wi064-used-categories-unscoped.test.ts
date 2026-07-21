import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

// WI-064 (expenses) — GET /expenses/used-categories with neither groupId nor
// friendId: a third, unscoped mode aggregating over the exact population
// GET /expenses' own default branch returns (payers ∪ splits ∪ createdById,
// deletedAt: null). Deliberately NOT mocking '../src/lib/prisma' — real
// Prisma groupBy DISTINCT against actual Expense/ExpensePayer/ExpenseSplit
// rows, same technique as wi032/wi063's used-categories tests.
//
// Spec: .company/domains/expenses/specs/spec-WI-064.md §3.1/§3.2

import { prisma } from '../src/lib/prisma';
import { buildApp } from '../src/app';

let app: FastifyInstance;
let viewerId: string;
let otherId: string; // co-participant on some fixtures
let strangerId: string; // shares nothing with viewer — used for the empty-array check
let tokenViewer: string;
let tokenStranger: string;
const STAMP = Date.now();

async function createTestUser(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `wi064-${label}-${STAMP}@test.local`,
      passwordHash: 'not-a-real-hash',
      name: `WI-064 Test ${label}`,
    },
  });
  return user.id;
}

beforeAll(async () => {
  viewerId = await createTestUser('viewer');
  otherId = await createTestUser('other');
  strangerId = await createTestUser('stranger');

  function baseExpense(overrides: Record<string, unknown> = {}) {
    return {
      description: 'WI-064 fixture',
      amount: 1000,
      currency: 'USD',
      date: new Date('2026-07-10T00:00:00.000Z'),
      splitType: 'EQUAL' as const,
      createdById: otherId,
      ...overrides,
    };
  }

  // Two non-deleted expenses sharing FOOD_DRINK (DISTINCT must collapse
  // them into one entry) where viewer is a payer/participant.
  await prisma.expense.create({
    data: baseExpense({
      category: 'FOOD_DRINK',
      createdById: viewerId,
      payers: { create: [{ userId: viewerId, amount: 1000 }] },
      splits: { create: [{ userId: viewerId, amount: 500 }, { userId: otherId, amount: 500 }] },
    }),
  });
  await prisma.expense.create({
    data: baseExpense({
      category: 'FOOD_DRINK',
      payers: { create: [{ userId: otherId, amount: 1000 }] },
      splits: { create: [{ userId: viewerId, amount: 500 }, { userId: otherId, amount: 500 }] },
    }),
  });

  // One non-deleted HOME expense where viewer is only `createdById` — not a
  // payer or split participant (N1's load-bearing case).
  await prisma.expense.create({
    data: baseExpense({
      category: 'HOME',
      createdById: viewerId,
      payers: { create: [{ userId: otherId, amount: 1000 }] },
      splits: { create: [{ userId: otherId, amount: 1000 }] },
    }),
  });

  // One soft-deleted-only GIFTS expense involving viewer — must be excluded.
  await prisma.expense.create({
    data: baseExpense({
      category: 'GIFTS',
      createdById: viewerId,
      deletedAt: new Date(),
      payers: { create: [{ userId: viewerId, amount: 1000 }] },
      splits: { create: [{ userId: viewerId, amount: 1000 }] },
    }),
  });

  // One non-deleted UTILITIES expense that does not involve viewer at all —
  // must be excluded.
  await prisma.expense.create({
    data: baseExpense({
      category: 'UTILITIES',
      createdById: otherId,
      payers: { create: [{ userId: otherId, amount: 1000 }] },
      splits: { create: [{ userId: otherId, amount: 1000 }] },
    }),
  });

  app = await buildApp();
  await app.ready();
  tokenViewer = app.jwt.sign({ sub: viewerId });
  tokenStranger = app.jwt.sign({ sub: strangerId });
});

afterAll(async () => {
  await app?.close();
  await prisma.expense.deleteMany({ where: { createdById: { in: [viewerId, otherId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [viewerId, otherId, strangerId] } } });
  await prisma.$disconnect();
});

async function getUsedCategories(token: string) {
  return app.inject({
    method: 'GET',
    url: '/api/v1/expenses/used-categories',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe('GET /expenses/used-categories (unscoped, WI-064)', () => {
  it('returns the distinct non-deleted categories across all of the caller\'s expenses (involved-in or created-by), excluding a soft-deleted-only category and expenses not involving the caller', async () => {
    const res = await getUsedCategories(tokenViewer);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.categories).toHaveLength(2);
    expect(new Set(body.categories)).toEqual(new Set(['FOOD_DRINK', 'HOME']));
    expect(body.categories).not.toContain('GIFTS');
    expect(body.categories).not.toContain('UTILITIES');
  });

  it('returns an empty array (not an error) for a caller with zero expenses', async () => {
    const res = await getUsedCategories(tokenStranger);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ categories: [] });
  });

  it('requires authentication', async () => {
    const res = await getUsedCategories('');
    expect(res.statusCode).toBe(401);
  });
});
