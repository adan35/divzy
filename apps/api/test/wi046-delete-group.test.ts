// WI-046 — POST /groups/:groupId/delete (ADMIN-only, group-wide fully settled,
// soft-delete via Group.deletedAt). Written directly from
// spec-WI-033-046-048.md's "API contract" + ADR-WI-046, TDD red-first against
// the pre-change route (no such endpoint existed -> 404 on every call).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const groupMemberFindFirstMock = vi.fn();
const groupMemberUpdateManyMock = vi.fn().mockResolvedValue({ count: 0 });
const groupUpdateMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();

// POST /groups/:groupId/delete runs group.update + groupMember.updateMany
// inside prisma.$transaction(async (tx) => ...) (WI-046-1 fix) — the mock tx
// object reuses these same top-level mocks so existing assertions on
// groupUpdateMock/groupMemberUpdateManyMock keep working unchanged.
const txMock = {
  group: { update: (...args: unknown[]) => groupUpdateMock(...args) },
  groupMember: { updateMany: (...args: unknown[]) => groupMemberUpdateManyMock(...args) },
};

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    groupMember: { findFirst: (...args: unknown[]) => groupMemberFindFirstMock(...args) },
    group: { update: (...args: unknown[]) => groupUpdateMock(...args) },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: { findMany: (...args: unknown[]) => settlementFindManyMock(...args) },
    $transaction: (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock),
  },
}));

const recordActivityMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/lib/activity', () => ({
  recordActivity: (...args: unknown[]) => recordActivityMock(...args),
}));

import { buildApp } from '../src/app';

let app: FastifyInstance;
let token: string;

const GROUP_ID = 'group_0000001';
const ADMIN_ID = 'user_admin001';
const MEMBER_ID = 'user_member01';

function updatedGroupRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: GROUP_ID,
    name: 'Roomies',
    deletedAt: new Date('2026-07-17T00:00:00.000Z'),
    members: [
      { userId: ADMIN_ID, leftAt: null },
      { userId: MEMBER_ID, leftAt: null },
    ],
    ...overrides,
  };
}

beforeEach(async () => {
  groupMemberFindFirstMock.mockReset();
  groupMemberUpdateManyMock.mockReset();
  groupUpdateMock.mockReset();
  expenseFindManyMock.mockReset();
  settlementFindManyMock.mockReset();
  groupMemberUpdateManyMock.mockResolvedValue({ count: 0 });
  expenseFindManyMock.mockResolvedValue([]);
  settlementFindManyMock.mockResolvedValue([]);
  recordActivityMock.mockClear();
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: ADMIN_ID });
});

afterEach(async () => {
  await app.close();
});

describe('POST /api/v1/groups/:groupId/delete', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/groups/${GROUP_ID}/delete` });
    expect(res.statusCode).toBe(401);
  });

  it('404s a non-member (never 403 — no existence leak)', async () => {
    groupMemberFindFirstMock.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/delete`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
    expect(groupUpdateMock).not.toHaveBeenCalled();
  });

  it('404s a member of an already-deleted group (assertActiveMember excludes deletedAt groups)', async () => {
    // assertActiveMember's own query filters group.deletedAt: null, so a
    // deleted group's membership row is simply never returned by the mock —
    // simulated here by resolving null, same as "no membership found".
    groupMemberFindFirstMock.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/delete`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('403s an active non-admin member', async () => {
    groupMemberFindFirstMock.mockResolvedValue({ role: 'MEMBER' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/delete`,
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: MEMBER_ID })}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
    expect(groupUpdateMock).not.toHaveBeenCalled();
  });

  it('409s when any member has a nonzero net in any currency (OUTSTANDING_BALANCE, group-wide)', async () => {
    groupMemberFindFirstMock.mockResolvedValue({ role: 'ADMIN' });
    expenseFindManyMock.mockResolvedValue([
      {
        currency: 'USD',
        payers: [{ userId: ADMIN_ID, amount: 5000 }],
        splits: [
          { userId: ADMIN_ID, amount: 2500 },
          { userId: MEMBER_ID, amount: 2500 },
        ],
      },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/delete`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('OUTSTANDING_BALANCE');
    expect(groupUpdateMock).not.toHaveBeenCalled();
  });

  it('admin deletes a fully settled group: sets deletedAt, records GROUP_UPDATED {deleted: true}, 204', async () => {
    groupMemberFindFirstMock.mockResolvedValue({ role: 'ADMIN' });
    // Fully settled: no expenses, no settlements -> nets all zero.
    groupUpdateMock.mockResolvedValue(updatedGroupRow());

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/delete`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(groupUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: GROUP_ID },
        data: { deletedAt: expect.any(Date) },
      }),
    );
    expect(recordActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'GROUP_UPDATED',
        actorId: ADMIN_ID,
        groupId: GROUP_ID,
        data: expect.objectContaining({ deleted: true }),
        recipientIds: expect.arrayContaining([ADMIN_ID, MEMBER_ID]),
      }),
    );
  });

  // WI-046-1 (Security defect loop-back, HIGH): delete must bulk-deactivate
  // every active GroupMember row in the same transaction as Group.deletedAt,
  // reusing the leftAt: null chokepoint every sibling domain's own
  // membership guard already checks — see defect-WI-033-046-048.md.
  it('bulk-deactivates every active membership row in the same transaction, same timestamp as deletedAt, and fires exactly one GROUP_UPDATED activity (no per-member MEMBER_LEFT spam)', async () => {
    groupMemberFindFirstMock.mockResolvedValue({ role: 'ADMIN' });
    groupUpdateMock.mockResolvedValue(updatedGroupRow());

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/delete`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);
    expect(groupMemberUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(groupMemberUpdateManyMock).toHaveBeenCalledWith({
      where: { groupId: GROUP_ID, leftAt: null },
      data: { leftAt: expect.any(Date) },
    });
    // Same timestamp on both writes (clean audit trail).
    const deleteTimestamp = groupUpdateMock.mock.calls[0]![0].data.deletedAt as Date;
    const deactivateTimestamp = groupMemberUpdateManyMock.mock.calls[0]![0].data.leftAt as Date;
    expect(deactivateTimestamp.getTime()).toBe(deleteTimestamp.getTime());
    // Not a loop over per-member deactivation/removal — exactly one activity,
    // never MEMBER_LEFT.
    expect(recordActivityMock).toHaveBeenCalledTimes(1);
    expect(recordActivityMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'MEMBER_LEFT' }),
    );
  });

  it('is allowed on a group regardless of archive state (delete does not require archiving first)', async () => {
    groupMemberFindFirstMock.mockResolvedValue({ role: 'ADMIN' });
    groupUpdateMock.mockResolvedValue(updatedGroupRow());

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/delete`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);
  });

  it('does not touch the existing DELETE /groups/:groupId archive endpoint', async () => {
    // Sanity guard: the new /delete action route must be additive, not a
    // replacement — this is exercised fully by wi027-unarchive.test.ts and
    // groups-route.test.ts; here we just confirm the route table still has
    // both verbs registered by checking method mismatch behaves as routing
    // (not a a 404 override on POST /delete).
    groupMemberFindFirstMock.mockResolvedValue(null);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/groups/${GROUP_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    // Still routes through assertAdmin -> assertActiveMember -> 404 (non-member),
    // proving DELETE :groupId is untouched and independently reachable.
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });
});
