// WI-053 — POST /groups/:groupId/unarchive 403 now names the group's actual
// active admin(s) instead of the generic "Only group admins can do this"
// (forbiddenUnarchiveError, spec-WI-053 D1-D3). Written directly from
// story-WI-053.md's Gherkin scenarios, not from the implementation. Mirrors
// wi027-unarchive.test.ts's own mocking convention (that file now also
// mocks groupMember.findMany post-WI-053; extended here rather than
// duplicated, per this domain's "match the sibling file's own convention"
// rule) plus wi046-delete-group.test.ts's admin-gated-route regression style
// for the "other five call sites unaffected" guard below.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const groupMemberFindFirstMock = vi.fn();
const groupMemberFindManyMock = vi.fn();
const groupMemberUpdateMock = vi.fn();
const groupFindUniqueMock = vi.fn();
const groupUpdateMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    groupMember: {
      findFirst: (...args: unknown[]) => groupMemberFindFirstMock(...args),
      findMany: (...args: unknown[]) => groupMemberFindManyMock(...args),
      update: (...args: unknown[]) => groupMemberUpdateMock(...args),
    },
    group: {
      findUnique: (...args: unknown[]) => groupFindUniqueMock(...args),
      update: (...args: unknown[]) => groupUpdateMock(...args),
    },
  },
}));

const recordActivityMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/lib/activity', () => ({
  recordActivity: (...args: unknown[]) => recordActivityMock(...args),
}));

import { buildApp } from '../src/app';

let app: FastifyInstance;

const GROUP_ID = 'group_0000001';
const ADMIN_ID = 'user_admin001';
const ADMIN2_ID = 'user_admin002';
const ADMIN3_ID = 'user_admin003';
const MEMBER_ID = 'user_member01';

function adminRow(id: string, name: string, joinedAt: string) {
  return { user: { id, name, avatarColor: '#111', avatarUrl: null }, joinedAt };
}

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
    createdBy: { id: ADMIN_ID, name: 'Alex', avatarColor: '#111' },
    members: [
      {
        userId: ADMIN_ID,
        role: 'ADMIN',
        leftAt: null,
        joinedAt: new Date('2026-01-01T00:00:00.000Z'),
        user: { id: ADMIN_ID, name: 'Alex', avatarColor: '#111' },
      },
    ],
    ...overrides,
  };
}

beforeEach(async () => {
  groupMemberFindFirstMock.mockReset();
  groupMemberFindManyMock.mockReset();
  groupMemberUpdateMock.mockReset();
  groupFindUniqueMock.mockReset();
  groupUpdateMock.mockReset();
  recordActivityMock.mockClear();
  app = await buildApp();
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('POST /api/v1/groups/:groupId/unarchive — names the actual admin(s) (story-WI-053)', () => {
  it('single admin: 403 names them by name, not the generic message', async () => {
    groupMemberFindFirstMock.mockResolvedValue({ role: 'MEMBER' });
    groupMemberFindManyMock.mockResolvedValue([adminRow(ADMIN_ID, 'Alex', '2026-01-01T00:00:00.000Z')]);

    const token = app.jwt.sign({ sub: MEMBER_ID });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/unarchive`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
    expect(res.json().message).toBe('Only Alex can unarchive this group.');
    expect(res.json().message).not.toBe('Only group admins can do this');
  });

  it('two admins: both named, joined with "or", no Oxford comma', async () => {
    groupMemberFindFirstMock.mockResolvedValue({ role: 'MEMBER' });
    groupMemberFindManyMock.mockResolvedValue([
      adminRow(ADMIN_ID, 'Alex', '2026-01-01T00:00:00.000Z'),
      adminRow(ADMIN2_ID, 'Bea', '2026-01-02T00:00:00.000Z'),
    ]);

    const token = app.jwt.sign({ sub: MEMBER_ID });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/unarchive`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().message).toBe('Only Alex or Bea can unarchive this group.');
  });

  it('three or more admins: no valid admin omitted from the message', async () => {
    groupMemberFindFirstMock.mockResolvedValue({ role: 'MEMBER' });
    groupMemberFindManyMock.mockResolvedValue([
      adminRow(ADMIN_ID, 'Alex', '2026-01-01T00:00:00.000Z'),
      adminRow(ADMIN2_ID, 'Bea', '2026-01-02T00:00:00.000Z'),
      adminRow(ADMIN3_ID, 'Chris', '2026-01-03T00:00:00.000Z'),
    ]);

    const token = app.jwt.sign({ sub: MEMBER_ID });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/unarchive`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    const message = res.json().message as string;
    expect(message).toBe('Only Alex, Bea or Chris can unarchive this group.');
    expect(message).toContain('Alex');
    expect(message).toContain('Bea');
    expect(message).toContain('Chris');
  });

  it('non-member still gets 404, never 403 — the member-only-visibility rule is unchanged', async () => {
    groupMemberFindFirstMock.mockResolvedValue(null);

    const token = app.jwt.sign({ sub: MEMBER_ID });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/unarchive`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
    // The admin-name lookup must never run for a non-member (no existence leak).
    expect(groupMemberFindManyMock).not.toHaveBeenCalled();
  });

  it('admin can still successfully unarchive (regression: success path unchanged)', async () => {
    groupMemberFindFirstMock.mockResolvedValue({ role: 'ADMIN' });
    groupFindUniqueMock.mockResolvedValue(groupRow());
    groupUpdateMock.mockResolvedValue(groupRow({ archivedAt: null }));

    const token = app.jwt.sign({ sub: ADMIN_ID });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/unarchive`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().archivedAt).toBeNull();
    // The admin-name lookup is only for the forbidden branch — the success
    // path never needs it.
    expect(groupMemberFindManyMock).not.toHaveBeenCalled();
  });
});

describe('assertAdmin — other five call sites unaffected (regression guard, story-WI-053)', () => {
  beforeEach(() => {
    groupMemberFindFirstMock.mockResolvedValue({ role: 'MEMBER' });
  });

  it('DELETE /groups/:groupId (archive) still 403s with the original generic message', async () => {
    const token = app.jwt.sign({ sub: MEMBER_ID });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/groups/${GROUP_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
    expect(res.json().message).toBe('Only group admins can do this');
    expect(groupMemberFindManyMock).not.toHaveBeenCalled();
  });

  it('POST /groups/:groupId/delete still 403s with the original generic message', async () => {
    const token = app.jwt.sign({ sub: MEMBER_ID });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/delete`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toBe('Only group admins can do this');
    expect(groupMemberFindManyMock).not.toHaveBeenCalled();
  });

  it('POST /groups/:groupId/invite-code/rotate still 403s with the original generic message', async () => {
    const token = app.jwt.sign({ sub: MEMBER_ID });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/invite-code/rotate`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toBe('Only group admins can do this');
    expect(groupMemberFindManyMock).not.toHaveBeenCalled();
  });

  it('PATCH /groups/:groupId/members/:userId (role change) still 403s with the original generic message', async () => {
    const token = app.jwt.sign({ sub: MEMBER_ID });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/groups/${GROUP_ID}/members/${ADMIN2_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: 'ADMIN' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toBe('Only group admins can do this');
    expect(groupMemberFindManyMock).not.toHaveBeenCalled();
  });

  it('DELETE /groups/:groupId/members/:userId (admin removal of another member) still 403s with the original generic message', async () => {
    const token = app.jwt.sign({ sub: MEMBER_ID });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/groups/${GROUP_ID}/members/${ADMIN2_ID}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toBe('Only group admins can do this');
    expect(groupMemberFindManyMock).not.toHaveBeenCalled();
  });
});
