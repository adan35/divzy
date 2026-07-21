// WI-027 — POST /groups/:groupId/unarchive (ADMIN-only, idempotent). Written
// directly from spec-WI-027.md's API contract + sequence flow, TDD red-first
// against the pre-change route (no such endpoint existed -> 404 on every call).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const groupMemberFindFirstMock = vi.fn();
// WI-053: the non-admin 403 branch now calls forbiddenUnarchiveError(groupId),
// which resolves the group's active admin names via one
// prisma.groupMember.findMany call — must be mocked or that branch throws
// (undefined not a function) instead of returning the expected 403.
const groupMemberFindManyMock = vi.fn();
const groupFindUniqueMock = vi.fn();
const groupUpdateMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    groupMember: {
      findFirst: (...args: unknown[]) => groupMemberFindFirstMock(...args),
      findMany: (...args: unknown[]) => groupMemberFindManyMock(...args),
    },
    group: {
      findUnique: (...args: unknown[]) => groupFindUniqueMock(...args),
      update: (...args: unknown[]) => groupUpdateMock(...args),
    },
  },
}));

const recordActivityMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/lib/activity', () => ({ recordActivity: (...args: unknown[]) => recordActivityMock(...args) }));

import { buildApp } from '../src/app';

let app: FastifyInstance;
let token: string;

const GROUP_ID = 'group_0000001';
const ADMIN_ID = 'user_admin001';
const MEMBER_ID = 'user_member01';

function groupRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: GROUP_ID,
    name: 'Roomies',
    emoji: '🏠',
    type: 'HOME',
    currency: 'USD',
    inviteCode: 'ABCDEFGHIJ',
    simplifyDebts: true,
    archivedAt: new Date('2026-07-10T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-10T00:00:00.000Z'),
    createdBy: { id: ADMIN_ID, name: 'Admin', avatarColor: '#111' },
    members: [
      {
        userId: ADMIN_ID,
        role: 'ADMIN',
        leftAt: null,
        joinedAt: new Date('2026-01-01T00:00:00.000Z'),
        user: { id: ADMIN_ID, name: 'Admin', avatarColor: '#111' },
      },
    ],
    ...overrides,
  };
}

beforeEach(async () => {
  groupMemberFindFirstMock.mockReset();
  groupMemberFindManyMock.mockReset();
  groupMemberFindManyMock.mockResolvedValue([
    { user: { id: ADMIN_ID, name: 'Admin', avatarColor: '#111', avatarUrl: null } },
  ]);
  groupFindUniqueMock.mockReset();
  groupUpdateMock.mockReset();
  recordActivityMock.mockClear();
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: ADMIN_ID });
});

afterEach(async () => {
  await app.close();
});

describe('POST /api/v1/groups/:groupId/unarchive', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/groups/${GROUP_ID}/unarchive` });
    expect(res.statusCode).toBe(401);
  });

  it('404s a non-member (never 403 — no existence leak)', async () => {
    groupMemberFindFirstMock.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/unarchive`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('403s an active non-admin member, naming the actual admin (WI-053)', async () => {
    groupMemberFindFirstMock.mockResolvedValue({ role: 'MEMBER' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/unarchive`,
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: MEMBER_ID })}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
    expect(res.json().message).toBe('Only Admin can unarchive this group.');
  });

  it('is idempotent on an already-active group: 200, current DTO, no write, no activity', async () => {
    groupMemberFindFirstMock.mockResolvedValue({ role: 'ADMIN' });
    groupFindUniqueMock.mockResolvedValue(groupRow({ archivedAt: null }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/unarchive`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().archivedAt).toBeNull();
    expect(groupUpdateMock).not.toHaveBeenCalled();
    expect(recordActivityMock).not.toHaveBeenCalled();
  });

  it('clears archivedAt, records GROUP_UPDATED {archived: false}, returns the updated DTO', async () => {
    groupMemberFindFirstMock.mockResolvedValue({ role: 'ADMIN' });
    groupFindUniqueMock.mockResolvedValue(groupRow());
    groupUpdateMock.mockResolvedValue(groupRow({ archivedAt: null }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/unarchive`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().archivedAt).toBeNull();
    expect(res.json().inviteCode).toBe('ABCDEFGHIJ'); // reused, not rotated (D3)
    expect(groupUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: GROUP_ID },
        data: { archivedAt: null },
      }),
    );
    expect(recordActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'GROUP_UPDATED',
        actorId: ADMIN_ID,
        groupId: GROUP_ID,
        data: expect.objectContaining({ archived: false }),
        recipientIds: [ADMIN_ID],
      }),
    );
  });
});
