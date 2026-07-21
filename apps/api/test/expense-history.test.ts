import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

// WI-017 (expenses) — per-expense edit history / audit trail, top-level
// scalar fields only. Deliberately NOT mocking '../src/lib/prisma' — this
// exercises the real ExpenseRevision table/migration end to end via the
// actual expense-service write paths and the new history endpoint, the same
// technique as wi002-integration-manual-rate-real-db.test.ts.
//
// Spec: .company/domains/expenses/specs/spec-WI-017.md

import { prisma } from '../src/lib/prisma';
import { diffTrackedFields } from '../src/services/expense-service';
import { processDueRecurring } from '../src/jobs/recurring';
import { buildApp } from '../src/app';

let app: FastifyInstance;
let userAId: string;
let userBId: string;
let userCId: string; // uninvolved third party — used for the visibility/404 test
let tokenA: string;
let tokenC: string;
const STAMP = Date.now();

async function createTestUser(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `expense-history-${label}-${STAMP}@test.local`,
      passwordHash: 'not-a-real-hash',
      name: `History Test ${label}`,
    },
  });
  return user.id;
}

beforeAll(async () => {
  userAId = await createTestUser('a');
  userBId = await createTestUser('b');
  userCId = await createTestUser('c');

  app = await buildApp();
  await app.ready();
  tokenA = app.jwt.sign({ sub: userAId });
  tokenC = app.jwt.sign({ sub: userCId });
});

afterAll(async () => {
  await app?.close();
  // Expense.createdBy has no cascade delete (Restrict), so expenses (and via
  // their own Cascade FK, ExpenseRevision/ExpensePayer/ExpenseSplit rows)
  // must be removed before the users that created them.
  await prisma.expense.deleteMany({ where: { createdById: { in: [userAId, userBId, userCId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId, userCId] } } });
  await prisma.$disconnect();
});

function baseExpensePayload(overrides: Record<string, unknown> = {}) {
  return {
    description: 'Dinner',
    amount: 2000,
    currency: 'USD',
    category: 'FOOD_DRINK',
    date: '2026-07-10T00:00:00.000Z',
    splitType: 'EQUAL',
    payers: [{ userId: userAId, amount: 2000 }],
    participants: [{ userId: userAId }, { userId: userBId }],
    ...overrides,
  };
}

async function createExpenseViaApi(overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/expenses',
    headers: { authorization: `Bearer ${tokenA}` },
    payload: baseExpensePayload(overrides),
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string };
}

async function getHistory(expenseId: string, token = tokenA) {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/expenses/${expenseId}/history`,
    headers: { authorization: `Bearer ${token}` },
  });
  return res;
}

describe('diffTrackedFields (pure helper)', () => {
  const existing = {
    description: 'Dinner',
    amount: 2000,
    currency: 'USD',
    category: 'FOOD_DRINK' as const,
    date: new Date('2026-07-10T00:00:00.000Z'),
    splitType: 'EQUAL' as const,
    notes: null,
    receiptUrl: null,
  };

  function input(overrides: Record<string, unknown> = {}) {
    return {
      description: 'Dinner',
      amount: 2000,
      currency: 'USD',
      category: 'FOOD_DRINK',
      date: '2026-07-10T00:00:00.000Z',
      splitType: 'EQUAL',
      payers: [],
      participants: [],
      ...overrides,
    } as never;
  }

  it('returns [] when nothing tracked changed', () => {
    expect(diffTrackedFields(existing, input())).toEqual([]);
  });

  it('detects a description change', () => {
    expect(diffTrackedFields(existing, input({ description: 'Lunch' }))).toEqual([
      { field: 'description', from: 'Dinner', to: 'Lunch' },
    ]);
  });

  it('detects an amount change and carries both currencies', () => {
    expect(diffTrackedFields(existing, input({ amount: 3000, currency: 'EUR' }))).toEqual([
      { field: 'amount', from: 2000, fromCurrency: 'USD', to: 3000, toCurrency: 'EUR' },
      { field: 'currency', from: 'USD', to: 'EUR' },
    ]);
  });

  it('detects a date change purely by instant, not string equality', () => {
    // Different string representation, same instant -> no change.
    expect(
      diffTrackedFields(existing, input({ date: new Date('2026-07-10T00:00:00.000Z').toISOString() })),
    ).toEqual([]);
    expect(diffTrackedFields(existing, input({ date: '2026-07-11T00:00:00.000Z' }))).toEqual([
      { field: 'date', from: '2026-07-10T00:00:00.000Z', to: '2026-07-11T00:00:00.000Z' },
    ]);
  });

  it('detects a category change', () => {
    expect(diffTrackedFields(existing, input({ category: 'TRANSPORT' }))).toEqual([
      { field: 'category', from: 'FOOD_DRINK', to: 'TRANSPORT' },
    ]);
  });

  it('detects a splitType change', () => {
    expect(diffTrackedFields(existing, input({ splitType: 'EXACT' }))).toEqual([
      { field: 'splitType', from: 'EQUAL', to: 'EXACT' },
    ]);
  });

  it('marks notes as added/removed/changed, never verbatim text', () => {
    expect(diffTrackedFields(existing, input({ notes: 'hello' }))).toEqual([
      { field: 'notes', change: 'added' },
    ]);
    expect(
      diffTrackedFields({ ...existing, notes: 'hello' }, input({})),
    ).toEqual([{ field: 'notes', change: 'removed' }]);
    expect(
      diffTrackedFields({ ...existing, notes: 'hello' }, input({ notes: 'world' })),
    ).toEqual([{ field: 'notes', change: 'changed' }]);
  });

  it('marks receiptUrl as added/removed/changed, never verbatim path', () => {
    expect(diffTrackedFields(existing, input({ receiptUrl: '/r/abc' }))).toEqual([
      { field: 'receiptUrl', change: 'added' },
    ]);
    expect(
      diffTrackedFields({ ...existing, receiptUrl: '/r/abc' }, input({})),
    ).toEqual([{ field: 'receiptUrl', change: 'removed' }]);
  });

  it('emits multiple changed fields in the fixed field-list order, not request order', () => {
    const changes = diffTrackedFields(
      existing,
      input({ receiptUrl: '/r/xyz', description: 'Lunch', splitType: 'EXACT' }),
    );
    expect(changes.map((c) => c.field)).toEqual(['description', 'splitType', 'receiptUrl']);
  });
});

describe('POST /expenses — CREATED revision', () => {
  it('writes exactly one CREATED revision, attributed to the actor, atomically with the insert', async () => {
    const expense = await createExpenseViaApi();

    const rows = await prisma.expenseRevision.findMany({ where: { expenseId: expense.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('CREATED');
    expect(rows[0].actorId).toBe(userAId);
    expect(rows[0].changes).toEqual([]);
  });

  it('exposes the CREATED entry via GET history, oldest-first, serialized through the DTO', async () => {
    const expense = await createExpenseViaApi();
    const res = await getHistory(expense.id);
    expect(res.statusCode).toBe(200);
    const history = res.json();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      expenseId: expense.id,
      kind: 'CREATED',
      changes: [],
      actor: { id: userAId },
    });
    expect(typeof history[0].createdAt).toBe('string');
  });
});

describe('Recurring-cron creation path — CREATED revision attribution', () => {
  it('attributes the CREATED entry to the schedule creator when posted via the cron job', async () => {
    const schedule = await prisma.recurringExpense.create({
      data: {
        description: 'Rent',
        amount: 5000,
        currency: 'USD',
        category: 'RENT',
        splitType: 'EQUAL',
        payers: [{ userId: userAId, amount: 5000 }],
        participants: [{ userId: userAId }, { userId: userBId }],
        frequency: 'MONTHLY',
        nextRunAt: new Date(Date.now() - 60_000), // due
        createdById: userAId,
      },
    });

    await processDueRecurring();

    const posted = await prisma.expense.findFirst({ where: { recurringExpenseId: schedule.id } });
    expect(posted).not.toBeNull();

    const rows = await prisma.expenseRevision.findMany({ where: { expenseId: posted!.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('CREATED');
    expect(rows[0].actorId).toBe(userAId); // schedule creator, no extra plumbing

    await prisma.recurringExpense.delete({ where: { id: schedule.id } }).catch(() => {});
  });
});

describe('PATCH /expenses/:id — UPDATED revision', () => {
  it('a single-field PATCH writes one UPDATED revision with the correct before/after, creation entry unchanged', async () => {
    const expense = await createExpenseViaApi();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/expenses/${expense.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: baseExpensePayload({ description: 'Lunch' }),
    });
    expect(res.statusCode).toBe(200);

    const rows = await prisma.expenseRevision.findMany({
      where: { expenseId: expense.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe('CREATED');
    expect(rows[1].kind).toBe('UPDATED');
    expect(rows[1].changes).toEqual([{ field: 'description', from: 'Dinner', to: 'Lunch' }]);
  });

  it('a multi-field PATCH in one request writes exactly ONE revision listing all changed fields', async () => {
    const expense = await createExpenseViaApi();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/expenses/${expense.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: baseExpensePayload({
        description: 'Brunch',
        amount: 4000,
        payers: [{ userId: userAId, amount: 4000 }],
      }),
    });
    expect(res.statusCode).toBe(200);

    const rows = await prisma.expenseRevision.findMany({
      where: { expenseId: expense.id, kind: 'UPDATED' },
    });
    expect(rows).toHaveLength(1);
    const fields = (rows[0].changes as Array<{ field: string }>).map((c) => c.field);
    expect(fields).toEqual(['description', 'amount']);
  });

  it('a no-op resubmit (identical scalar values) writes NO revision, despite wholesale payer/split replacement', async () => {
    const expense = await createExpenseViaApi();

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/expenses/${expense.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: baseExpensePayload(), // identical scalar values
    });
    expect(res.statusCode).toBe(200);

    const rows = await prisma.expenseRevision.findMany({ where: { expenseId: expense.id } });
    expect(rows).toHaveLength(1); // only the original CREATED
    expect(rows[0].kind).toBe('CREATED');
  });

  it('records notes/receiptUrl changes as added/removed/changed markers, not full text', async () => {
    const expense = await createExpenseViaApi();

    const addRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/expenses/${expense.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: baseExpensePayload({ notes: 'a very secret note', receiptUrl: '/receipts/abc123' }),
    });
    expect(addRes.statusCode).toBe(200);

    const removeRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/expenses/${expense.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: baseExpensePayload(), // notes/receiptUrl omitted -> removed
    });
    expect(removeRes.statusCode).toBe(200);

    const rows = await prisma.expenseRevision.findMany({
      where: { expenseId: expense.id, kind: 'UPDATED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(rows).toHaveLength(2);

    const addedChanges = rows[0].changes as Array<{ field: string; change?: string }>;
    expect(addedChanges).toEqual(
      expect.arrayContaining([
        { field: 'notes', change: 'added' },
        { field: 'receiptUrl', change: 'added' },
      ]),
    );
    // No verbatim text/path ever present in the payload.
    expect(JSON.stringify(addedChanges)).not.toContain('a very secret note');
    expect(JSON.stringify(addedChanges)).not.toContain('/receipts/abc123');

    const removedChanges = rows[1].changes as Array<{ field: string; change?: string }>;
    expect(removedChanges).toEqual(
      expect.arrayContaining([
        { field: 'notes', change: 'removed' },
        { field: 'receiptUrl', change: 'removed' },
      ]),
    );
  });
});

describe('GET /expenses/:id/history — visibility', () => {
  it('404s for a user who cannot see the expense, exactly like the expense-detail endpoint', async () => {
    const expense = await createExpenseViaApi();
    const res = await getHistory(expense.id, tokenC);
    expect(res.statusCode).toBe(404);
  });

  it('orders entries oldest-first', async () => {
    const expense = await createExpenseViaApi();
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/expenses/${expense.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: baseExpensePayload({ description: 'Second' }),
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/expenses/${expense.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: baseExpensePayload({ description: 'Third' }),
    });

    const res = await getHistory(expense.id);
    expect(res.statusCode).toBe(200);
    const history = res.json();
    expect(history).toHaveLength(3);
    expect(history[0].kind).toBe('CREATED');
    expect(history[1].changes[0]).toMatchObject({ to: 'Second' });
    expect(history[2].changes[0]).toMatchObject({ to: 'Third' });
    const timestamps = history.map((h: { createdAt: string }) => new Date(h.createdAt).getTime());
    expect([...timestamps].sort((a, b) => a - b)).toEqual(timestamps);
  });
});
