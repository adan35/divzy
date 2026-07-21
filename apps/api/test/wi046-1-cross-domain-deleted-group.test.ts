// WI-046-1 — Security defect loop-back (HIGH, defect-WI-033-046-048.md):
// POST /groups/:groupId/delete must bulk-deactivate every active
// GroupMember row (leftAt) in the same transaction as Group.deletedAt, so
// every sibling domain's OWN membership guard (which keys off
// GroupMember.leftAt — never Group.deletedAt) naturally rejects a former
// member of a deleted group, with zero changes to any sibling-owned route
// file. This test proves that closure end-to-end across the domain
// boundary: it drives the real groups.ts delete route AND the real
// expenses.ts / expense-service.ts / settlements.ts route handlers against
// one shared in-memory GroupMember store (via the module-level
// '../src/lib/prisma' mock, same technique as
// wi016-share-link-integration.test.ts), so the only thing "faked" is the
// database row storage — the authorization logic under test is 100% real,
// unmodified sibling-domain code.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// zId requires >= 8 chars.
const GROUP_ID = 'group_0000001';
const ADMIN_ID = 'user_admin001';
const MEMBER_ID = 'user_member01';

interface MemberRow {
  groupId: string;
  userId: string;
  role: 'ADMIN' | 'MEMBER';
  leftAt: Date | null;
}

let memberRows: MemberRow[];

function resetStore() {
  memberRows = [
    { groupId: GROUP_ID, userId: ADMIN_ID, role: 'ADMIN', leftAt: null },
    { groupId: GROUP_ID, userId: MEMBER_ID, role: 'MEMBER', leftAt: null },
  ];
}

const groupMemberFindFirstMock = vi.fn();
const groupMemberFindManyMock = vi.fn();
const groupMemberUpdateManyMock = vi.fn();
const groupUpdateMock = vi.fn();
const groupFindUniqueMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();

const txMock = {
  group: { update: (...args: unknown[]) => groupUpdateMock(...args) },
  groupMember: { updateMany: (...args: unknown[]) => groupMemberUpdateManyMock(...args) },
};

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    groupMember: {
      findFirst: (...args: unknown[]) => groupMemberFindFirstMock(...args),
      findMany: (...args: unknown[]) => groupMemberFindManyMock(...args),
      updateMany: (...args: unknown[]) => groupMemberUpdateManyMock(...args),
    },
    group: {
      update: (...args: unknown[]) => groupUpdateMock(...args),
      findUnique: (...args: unknown[]) => groupFindUniqueMock(...args),
    },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: { findMany: (...args: unknown[]) => settlementFindManyMock(...args) },
    $transaction: (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock),
  },
}));

vi.mock('../src/lib/activity', () => ({ recordActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/lib/social', () => ({ ensureFriendshipsAmong: vi.fn().mockResolvedValue(undefined) }));

import { buildApp } from '../src/app';

let app: FastifyInstance;
let adminToken: string;
let memberToken: string;

beforeEach(async () => {
  resetStore();
  vi.clearAllMocks();

  groupMemberFindFirstMock.mockImplementation(
    async ({ where }: { where: { groupId: string; userId: string; leftAt?: null } }) => {
      const row = memberRows.find(
        (r) => r.groupId === where.groupId && r.userId === where.userId,
      );
      if (!row) return null;
      if (where.leftAt === null && row.leftAt !== null) return null;
      return { ...row };
    },
  );

  groupMemberFindManyMock.mockImplementation(
    async ({ where }: { where: { groupId: string; leftAt?: null } }) =>
      memberRows
        .filter((r) => r.groupId === where.groupId && (where.leftAt !== null || r.leftAt === null))
        .map((r) => ({ userId: r.userId })),
  );

  groupMemberUpdateManyMock.mockImplementation(
    async ({
      where,
      data,
    }: {
      where: { groupId: string; leftAt?: null };
      data: { leftAt: Date };
    }) => {
      let count = 0;
      for (const r of memberRows) {
        if (r.groupId === where.groupId && (where.leftAt !== null || r.leftAt === null)) {
          r.leftAt = data.leftAt;
          count += 1;
        }
      }
      return { count };
    },
  );

  // Group.update — the delete route's own write. Captured member snapshot
  // reflects the store as of *this* call, i.e. before groupMember.updateMany
  // runs within the same transaction (matches real sequential-transaction
  // ordering), so GROUP_UPDATED recipientIds still include the about-to-be-
  // deactivated members.
  groupUpdateMock.mockImplementation(async () => ({
    id: GROUP_ID,
    name: 'Roomies',
    members: memberRows
      .filter((r) => r.groupId === GROUP_ID)
      .map((r) => ({ userId: r.userId, leftAt: r.leftAt })),
  }));

  // expense-service's validateInvolvedUsers: group.findUnique with
  // { members: { where: { leftAt: null }, select: { userId: true } } }.
  groupFindUniqueMock.mockImplementation(async ({ where }: { where: { id: string } }) => {
    if (where.id !== GROUP_ID) return null;
    return {
      members: memberRows
        .filter((r) => r.groupId === GROUP_ID && r.leftAt === null)
        .map((r) => ({ userId: r.userId })),
    };
  });

  // Fully settled ledger (no expenses/settlements) so assertGroupSettled
  // never blocks the delete itself.
  expenseFindManyMock.mockResolvedValue([]);
  settlementFindManyMock.mockResolvedValue([]);

  app = await buildApp();
  await app.ready();
  adminToken = app.jwt.sign({ sub: ADMIN_ID });
  memberToken = app.jwt.sign({ sub: MEMBER_ID });
});

afterEach(async () => {
  await app.close();
});

async function deleteGroup() {
  return app.inject({
    method: 'POST',
    url: `/api/v1/groups/${GROUP_ID}/delete`,
    headers: { authorization: `Bearer ${adminToken}` },
  });
}

describe('WI-046-1 — deleting a group closes sibling-domain read/write reachability for former members', () => {
  it('sets leftAt on every active GroupMember row of the group as part of delete', async () => {
    const res = await deleteGroup();
    expect(res.statusCode).toBe(204);
    expect(memberRows.every((r) => r.leftAt !== null)).toBe(true);
  });

  it('GET /expenses?groupId=<deleted> now 404s for a former member (expenses.ts:65-69 leftAt:null guard, unmodified)', async () => {
    // Baseline: before delete, the same call succeeds (200).
    const before = await app.inject({
      method: 'GET',
      url: `/api/v1/expenses?groupId=${GROUP_ID}`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(before.statusCode).toBe(200);

    const del = await deleteGroup();
    expect(del.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/expenses?groupId=${GROUP_ID}`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(after.statusCode).toBe(404);
    expect(after.json().code).toBe('NOT_FOUND');
  });

  it('POST /expenses into a deleted group now 404s for a former member (expense-service.ts validateInvolvedUsers, unmodified)', async () => {
    const del = await deleteGroup();
    expect(del.statusCode).toBe(204);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/expenses',
      headers: { authorization: `Bearer ${memberToken}` },
      payload: {
        groupId: GROUP_ID,
        description: 'Sneaky post-delete expense',
        amount: 1000,
        currency: 'USD',
        category: 'FOOD_DRINK',
        date: '2026-07-17T00:00:00.000Z',
        splitType: 'EQUAL',
        payers: [{ userId: MEMBER_ID, amount: 1000 }],
        participants: [{ userId: MEMBER_ID }],
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('GET /settlements?groupId=<deleted> now 404s for a former member (settlements.ts:25-31 leftAt:null guard, unmodified)', async () => {
    const before = await app.inject({
      method: 'GET',
      url: `/api/v1/settlements?groupId=${GROUP_ID}`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(before.statusCode).toBe(200);

    const del = await deleteGroup();
    expect(del.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/settlements?groupId=${GROUP_ID}`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(after.statusCode).toBe(404);
    expect(after.json().code).toBe('NOT_FOUND');
  });

  it('POST /settlements into a deleted group now 404s for a former member (settlements.ts groupMember.findMany memberIds check, unmodified)', async () => {
    const del = await deleteGroup();
    expect(del.statusCode).toBe(204);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/settlements',
      headers: { authorization: `Bearer ${memberToken}` },
      payload: {
        groupId: GROUP_ID,
        fromUserId: MEMBER_ID,
        toUserId: ADMIN_ID,
        amount: 500,
        currency: 'USD',
        method: 'CASH',
        date: '2026-07-17T00:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });
});
