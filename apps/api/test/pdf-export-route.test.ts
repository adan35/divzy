import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const groupMemberFindFirstMock = vi.fn();
const groupMemberFindManyMock = vi.fn();
const groupFindUniqueMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    group: { findUnique: (...args: unknown[]) => groupFindUniqueMock(...args) },
    groupMember: {
      findFirst: (...args: unknown[]) => groupMemberFindFirstMock(...args),
      findMany: (...args: unknown[]) => groupMemberFindManyMock(...args),
    },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: { findMany: (...args: unknown[]) => settlementFindManyMock(...args) },
  },
}));

import { buildApp } from '../src/app';

let app: FastifyInstance;
let token: string;

const USER_ID = 'user_1';
const GROUP_ID = 'group_id_1';

beforeEach(async () => {
  groupMemberFindFirstMock.mockReset();
  groupMemberFindManyMock.mockReset();
  groupFindUniqueMock.mockReset();
  expenseFindManyMock.mockReset();
  settlementFindManyMock.mockReset();

  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: USER_ID });
});

afterEach(async () => {
  await app.close();
});

function activeMember() {
  return { id: 'gm_1' };
}

function members() {
  return [
    { userId: USER_ID, user: { name: 'Zain' } },
    { userId: 'user_2', user: { name: 'Friend' } },
  ];
}

describe('GET /api/v1/groups/:groupId/export.pdf', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/groups/${GROUP_ID}/export.pdf` });
    expect(res.statusCode).toBe(401);
  });

  it('404s for a non-member without leaking group existence (same guard as CSV)', async () => {
    groupMemberFindFirstMock.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${GROUP_ID}/export.pdf`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code ?? res.json().error?.code).toBe('NOT_FOUND');
  });

  it('returns a PDF with the correct content-type for an active member, excluding soft-deleted rows', async () => {
    groupMemberFindFirstMock.mockResolvedValue(activeMember());
    groupFindUniqueMock.mockResolvedValue({ name: 'Trip to Kuwait' });
    groupMemberFindManyMock.mockResolvedValue(members());
    expenseFindManyMock.mockResolvedValue([
      {
        date: new Date('2026-01-05T10:00:00Z'),
        description: 'Dinner',
        category: 'FOOD_DRINK',
        currency: 'USD',
        amount: 2000,
        splitType: 'EQUAL',
        payers: [{ userId: USER_ID, amount: 2000, user: { name: 'Zain' } }],
        splits: [
          { userId: USER_ID, amount: 1000 },
          { userId: 'user_2', amount: 1000 },
        ],
      },
    ]);
    settlementFindManyMock.mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${GROUP_ID}/export.pdf`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('.pdf');
    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''");
    expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // Same deletedAt: null filters as the CSV route.
    expect(expenseFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ groupId: GROUP_ID, deletedAt: null }) }),
    );
    expect(settlementFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ groupId: GROUP_ID, deletedAt: null }) }),
    );
  });

  it('returns a valid PDF for an empty group instead of an error', async () => {
    groupMemberFindFirstMock.mockResolvedValue(activeMember());
    groupFindUniqueMock.mockResolvedValue({ name: 'Empty Group' });
    groupMemberFindManyMock.mockResolvedValue(members());
    expenseFindManyMock.mockResolvedValue([]);
    settlementFindManyMock.mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${GROUP_ID}/export.pdf`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
