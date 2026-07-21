// WI-039b (settlements slice) — GET /settlements/:settlementId (new read
// endpoint, DRB condition 2: no `deletedAt` filter, soft-deleted rows return
// 200) and the additive group-admin DELETE authz extension (DRB condition 3).
// TDD: written directly from spec-WI-039b.md §1/§2 and story-WI-039b.md's
// Gherkin AC before the route/authz change existed — run red first (no GET
// handler at all; DELETE's group-member read only selects `id`, so no admin
// path exists), then made green by the minimal additive changes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const settlementFindUniqueMock = vi.fn();
const settlementFindFirstMock = vi.fn();
const settlementUpdateMock = vi.fn();
const groupMemberFindFirstMock = vi.fn();
const groupMemberFindManyMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    groupMember: {
      findFirst: (...args: unknown[]) => groupMemberFindFirstMock(...args),
      findMany: (...args: unknown[]) => groupMemberFindManyMock(...args),
    },
    settlement: {
      findUnique: (...args: unknown[]) => settlementFindUniqueMock(...args),
      findFirst: (...args: unknown[]) => settlementFindFirstMock(...args),
      update: (...args: unknown[]) => settlementUpdateMock(...args),
    },
  },
}));

vi.mock('../src/lib/activity', () => ({ recordActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/lib/social', () => ({ ensureFriendshipsAmong: vi.fn().mockResolvedValue(undefined) }));

import { buildApp } from '../src/app';

let app: FastifyInstance;
let token: string;

const ME = 'user_me_0001'; // zId requires >= 8 chars
const ANA = 'user_ana_0001';
const SAM = 'user_sam_0001';
const PRIYA = 'user_priya01';
const JORDAN = 'user_jordan1';
const GROUP = 'grp_goa_trip1';

function freshSettlement(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'settlement_1',
    groupId: null,
    fromUserId: ANA,
    toUserId: SAM,
    amount: 1500,
    currency: 'PKR',
    method: 'BANK_TRANSFER',
    note: null,
    proofUrl: null,
    date: new Date('2026-07-10T00:00:00.000Z'),
    createdById: SAM,
    deletedAt: null,
    createdAt: new Date('2026-07-10T00:00:00.000Z'),
    fromUser: { id: ANA, name: 'Ana', avatarColor: '#111' },
    toUser: { id: SAM, name: 'Sam', avatarColor: '#222' },
    createdBy: { id: SAM, name: 'Sam', avatarColor: '#222' },
    group: null,
    ...overrides,
  };
}

function getSettlement(id = 'settlement_1') {
  return app.inject({
    method: 'GET',
    url: `/api/v1/settlements/${id}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

function deleteSettlement(id = 'settlement_1') {
  return app.inject({
    method: 'DELETE',
    url: `/api/v1/settlements/${id}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

beforeEach(async () => {
  for (const m of [
    settlementFindUniqueMock,
    settlementFindFirstMock,
    settlementUpdateMock,
    groupMemberFindFirstMock,
    groupMemberFindManyMock,
  ]) {
    m.mockReset();
  }
  groupMemberFindManyMock.mockResolvedValue([]);
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: ME });
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/v1/settlements/:settlementId', () => {
  it('active group member can read a group settlement (200, full DTO, no deletedAt filter in the query)', async () => {
    const settlement = freshSettlement({
      groupId: GROUP,
      group: { id: GROUP, name: 'Goa Trip', emoji: '🌴' },
    });
    settlementFindUniqueMock.mockResolvedValue(settlement);
    groupMemberFindFirstMock.mockResolvedValue({ id: 'gm1' }); // active member

    const res = await getSettlement();

    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe('settlement_1');
    expect(res.json().group).toEqual({ id: GROUP, name: 'Goa Trip', emoji: '🌴' });
    // No deletedAt filter — pure findUnique by id.
    expect(settlementFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'settlement_1' } }),
    );
    expect(Object.keys(settlementFindUniqueMock.mock.calls[0][0].where)).toEqual(['id']);
  });

  it('a party (payer) can read a direct settlement', async () => {
    settlementFindUniqueMock.mockResolvedValue(freshSettlement());
    token = app.jwt.sign({ sub: ANA });

    const res = await getSettlement();

    expect(res.statusCode).toBe(200);
  });

  it('a party (recipient) can read a direct settlement', async () => {
    settlementFindUniqueMock.mockResolvedValue(freshSettlement());
    token = app.jwt.sign({ sub: SAM });

    const res = await getSettlement();

    expect(res.statusCode).toBe(200);
  });

  it('the creator can read a direct settlement even if not a party', async () => {
    settlementFindUniqueMock.mockResolvedValue(
      freshSettlement({ fromUserId: ANA, toUserId: SAM, createdById: ME }),
    );

    const res = await getSettlement();

    expect(res.statusCode).toBe(200);
  });

  it('non-member of the settlement group gets 404, never 403', async () => {
    settlementFindUniqueMock.mockResolvedValue(
      freshSettlement({ groupId: GROUP, group: { id: GROUP, name: 'Goa Trip', emoji: '🌴' } }),
    );
    groupMemberFindFirstMock.mockResolvedValue(null); // not an active member

    const res = await getSettlement();

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('a stranger to a direct settlement gets 404', async () => {
    settlementFindUniqueMock.mockResolvedValue(freshSettlement());

    const res = await getSettlement(); // caller is ME, not Ana/Sam/creator(Sam)

    expect(res.statusCode).toBe(404);
  });

  it('a nonexistent settlementId returns 404, indistinguishable from "exists but invisible"', async () => {
    settlementFindUniqueMock.mockResolvedValue(null);

    const res = await getSettlement('s_nonexistent1');

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('a soft-deleted settlement returns 200 with deletedAt populated, never 404 (DRB condition 2)', async () => {
    settlementFindUniqueMock.mockResolvedValue(
      freshSettlement({ deletedAt: new Date('2026-07-16T00:00:00.000Z') }),
    );
    token = app.jwt.sign({ sub: ANA });

    const res = await getSettlement();

    expect(res.statusCode).toBe(200);
    expect(res.json().deletedAt).toBe('2026-07-16T00:00:00.000Z');
    expect(res.json().amount).toBe(1500);
    expect(res.json().currency).toBe('PKR');
  });

  it('a soft-deleted settlement still enforces the same visibility rule (non-visible -> 404)', async () => {
    settlementFindUniqueMock.mockResolvedValue(
      freshSettlement({
        groupId: GROUP,
        group: { id: GROUP, name: 'Goa Trip', emoji: '🌴' },
        deletedAt: new Date('2026-07-16T00:00:00.000Z'),
      }),
    );
    groupMemberFindFirstMock.mockResolvedValue(null); // not an active member, never was a party

    const res = await getSettlement();

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/v1/settlements/:settlementId — additive group-admin authz', () => {
  it('direct settlement: payer/recipient/creator delete is unchanged (204)', async () => {
    settlementFindFirstMock.mockResolvedValue(freshSettlement());
    settlementUpdateMock.mockResolvedValue({});
    token = app.jwt.sign({ sub: ANA }); // payer

    const res = await deleteSettlement();

    expect(res.statusCode).toBe(204);
    expect(groupMemberFindFirstMock).not.toHaveBeenCalled();
  });

  it('direct settlement: a stranger gets 404, never 403', async () => {
    settlementFindFirstMock.mockResolvedValue(freshSettlement());

    const res = await deleteSettlement(); // ME is not a party or creator

    expect(res.statusCode).toBe(404);
  });

  it('group settlement: existing party (payer/creator) delete is unchanged (204)', async () => {
    settlementFindFirstMock.mockResolvedValue(
      freshSettlement({ groupId: GROUP, fromUserId: ANA, toUserId: SAM, createdById: ANA }),
    );
    settlementUpdateMock.mockResolvedValue({});
    token = app.jwt.sign({ sub: ANA });

    const res = await deleteSettlement();

    expect(res.statusCode).toBe(204);
  });

  it('group settlement: an active ADMIN who is not a party can delete (204), reads role', async () => {
    settlementFindFirstMock.mockResolvedValue(
      freshSettlement({ groupId: GROUP, fromUserId: ANA, toUserId: SAM, createdById: ANA }),
    );
    settlementUpdateMock.mockResolvedValue({});
    groupMemberFindFirstMock.mockResolvedValue({ role: 'ADMIN' });
    token = app.jwt.sign({ sub: PRIYA });

    const res = await deleteSettlement();

    expect(res.statusCode).toBe(204);
    expect(groupMemberFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { groupId: GROUP, userId: PRIYA, leftAt: null },
        select: { role: true },
      }),
    );
    expect(settlementUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'settlement_1' }, data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    );
  });

  it('group settlement: admin revert records SETTLEMENT_DELETED with actorId = admin', async () => {
    const { recordActivity } = await import('../src/lib/activity');
    settlementFindFirstMock.mockResolvedValue(
      freshSettlement({ groupId: GROUP, fromUserId: ANA, toUserId: SAM, createdById: ANA }),
    );
    settlementUpdateMock.mockResolvedValue({});
    groupMemberFindFirstMock.mockImplementation(async ({ where }: { where: { userId: string } }) =>
      where.userId === PRIYA ? { role: 'ADMIN' } : null,
    );
    token = app.jwt.sign({ sub: PRIYA });

    const res = await deleteSettlement();

    expect(res.statusCode).toBe(204);
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SETTLEMENT_DELETED', actorId: PRIYA }),
    );
  });

  it('group settlement: non-admin, non-party member gets explicit 403', async () => {
    settlementFindFirstMock.mockResolvedValue(
      freshSettlement({ groupId: GROUP, fromUserId: ANA, toUserId: SAM, createdById: ANA }),
    );
    groupMemberFindFirstMock.mockResolvedValue({ role: 'MEMBER' });
    token = app.jwt.sign({ sub: JORDAN });

    const res = await deleteSettlement();

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
    expect(settlementUpdateMock).not.toHaveBeenCalled();
  });

  it('group settlement: a former admin who left the group gets 404 (not an active member)', async () => {
    settlementFindFirstMock.mockResolvedValue(
      freshSettlement({ groupId: GROUP, fromUserId: ANA, toUserId: SAM, createdById: ANA }),
    );
    groupMemberFindFirstMock.mockResolvedValue(null); // leftAt: null filter excludes them
    token = app.jwt.sign({ sub: PRIYA });

    const res = await deleteSettlement();

    expect(res.statusCode).toBe(404);
    expect(settlementUpdateMock).not.toHaveBeenCalled();
  });

  it('admin path never applies to a direct (non-group) settlement — stranger still 404, no groupMember lookup', async () => {
    settlementFindFirstMock.mockResolvedValue(freshSettlement()); // groupId: null

    const res = await deleteSettlement();

    expect(res.statusCode).toBe(404);
    expect(groupMemberFindFirstMock).not.toHaveBeenCalled();
  });

  it('reverting an already-deleted settlement still 404s (unchanged lookup filter)', async () => {
    settlementFindFirstMock.mockResolvedValue(null); // where: { id, deletedAt: null } excludes it

    const res = await deleteSettlement();

    expect(res.statusCode).toBe(404);
    expect(settlementFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'settlement_1', deletedAt: null } }),
    );
  });
});
