// WI-023 — optional payment-proof attachment on a settlement (ADR-020).
// TDD: written directly from spec-WI-023.md §4.1-4.3 before `proofUrl` existed
// on the schema/zod input/DTO — run red first (parse/persist/serialize all
// missing the field), then made green by the minimal additive changes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const userFindUniqueMock = vi.fn();
const groupMemberFindManyMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const settlementCreateMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    groupMember: { findMany: (...args: unknown[]) => groupMemberFindManyMock(...args) },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: {
      findMany: (...args: unknown[]) => settlementFindManyMock(...args),
      create: (...args: unknown[]) => settlementCreateMock(...args),
    },
  },
}));

vi.mock('../src/lib/activity', () => ({ recordActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/lib/social', () => ({ ensureFriendshipsAmong: vi.fn().mockResolvedValue(undefined) }));

import { buildApp } from '../src/app';

let app: FastifyInstance;
let token: string;

const ME = 'user_me_001'; // zId requires >= 8 chars
const ANA = 'user_ana_001';

function freshSettlement(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 's1',
    groupId: null,
    fromUserId: ME,
    toUserId: ANA,
    amount: 3500,
    currency: 'USD',
    method: 'CASH',
    note: null,
    proofUrl: null,
    date: new Date('2026-07-15T00:00:00.000Z'),
    createdById: ME,
    deletedAt: null,
    createdAt: new Date('2026-07-15T00:00:00.000Z'),
    fromUser: { id: ME, name: 'Me', avatarColor: '#111' },
    toUser: { id: ANA, name: 'Ana', avatarColor: '#222' },
    createdBy: { id: ME, name: 'Me', avatarColor: '#111' },
    ...overrides,
  };
}

/** payerId paid `amount`; owerId's split is the full amount (a simple 1:1 debt). */
function expense(currency: string, amount: number, payerId: string, owerId: string) {
  return {
    groupId: null,
    currency,
    payers: [{ userId: payerId, amount }],
    splits: [
      { userId: owerId, amount },
      { userId: payerId, amount: 0 },
    ],
  };
}

function postSettlement(body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/settlements',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      fromUserId: ME,
      toUserId: ANA,
      amount: 3500,
      currency: 'USD',
      method: 'CASH',
      date: new Date('2026-07-15T00:00:00.000Z').toISOString(),
      ...body,
    },
  });
}

beforeEach(async () => {
  for (const m of [
    userFindUniqueMock,
    groupMemberFindManyMock,
    expenseFindManyMock,
    settlementFindManyMock,
    settlementCreateMock,
  ]) {
    m.mockReset();
  }
  userFindUniqueMock.mockResolvedValue({ id: ANA }); // counterpart exists, non-group path
  // ANA paid, ME owes ANA 3500 -> pairwise { from: ME, to: ANA, amount: 3500 } so the
  // full-amount settlement is within the outstanding bound (WI-012).
  expenseFindManyMock.mockResolvedValue([expense('USD', 3500, ANA, ME)]);
  settlementFindManyMock.mockResolvedValue([]);
  settlementCreateMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    freshSettlement(data),
  );
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: ME });
});

afterEach(async () => {
  await app.close();
});

describe('POST /api/v1/settlements — WI-023 proofUrl', () => {
  it('persists an attached proofUrl and returns it on the DTO', async () => {
    const res = await postSettlement({ proofUrl: '/uploads/receipts/abc123.jpg' });

    expect(res.statusCode).toBe(201);
    expect(settlementCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ proofUrl: '/uploads/receipts/abc123.jpg' }),
      }),
    );
    expect(res.json().proofUrl).toBe('/uploads/receipts/abc123.jpg');
  });

  it('creating with no attachment is unchanged: proofUrl is null and no existing validation is altered', async () => {
    const res = await postSettlement({});

    expect(res.statusCode).toBe(201);
    expect(settlementCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ proofUrl: null }) }),
    );
    expect(res.json().proofUrl).toBeNull();
  });

  it('rejects a proofUrl longer than 500 chars (validation parity with Expense.receiptUrl)', async () => {
    const res = await postSettlement({ proofUrl: 'a'.repeat(501) });

    expect(res.statusCode).toBe(400);
    expect(settlementCreateMock).not.toHaveBeenCalled();
  });

  it('trims whitespace on proofUrl (validation parity with Expense.receiptUrl)', async () => {
    const res = await postSettlement({ proofUrl: '  /uploads/receipts/abc123.jpg  ' });

    expect(res.statusCode).toBe(201);
    expect(settlementCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ proofUrl: '/uploads/receipts/abc123.jpg' }),
      }),
    );
  });
});
