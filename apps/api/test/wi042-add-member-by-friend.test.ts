// WI-042 — POST /groups/:groupId/members/by-friend (friendship-restricted
// member add). Written from spec-WI-042.md's API contract + sequence flow,
// TDD red-first against the pre-change route (no such endpoint existed).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const groupMemberFindFirstMock = vi.fn();
const friendshipFindUniqueMock = vi.fn();
const groupFindUniqueMock = vi.fn();
const groupFindUniqueOrThrowMock = vi.fn();
const groupMemberUpsertMock = vi.fn();
const userFindUniqueOrThrowMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    groupMember: {
      findFirst: (...args: unknown[]) => groupMemberFindFirstMock(...args),
      upsert: (...args: unknown[]) => groupMemberUpsertMock(...args),
    },
    friendship: { findUnique: (...args: unknown[]) => friendshipFindUniqueMock(...args) },
    group: {
      findUnique: (...args: unknown[]) => groupFindUniqueMock(...args),
      findUniqueOrThrow: (...args: unknown[]) => groupFindUniqueOrThrowMock(...args),
    },
    user: { findUniqueOrThrow: (...args: unknown[]) => userFindUniqueOrThrowMock(...args) },
  },
}));

const recordActivityMock = vi.fn().mockResolvedValue(undefined);
const ensureFriendshipsAmongMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/lib/activity', () => ({ recordActivity: (...args: unknown[]) => recordActivityMock(...args) }));
vi.mock('../src/lib/social', () => ({
  ensureFriendshipsAmong: (...args: unknown[]) => ensureFriendshipsAmongMock(...args),
}));

import { buildApp } from '../src/app';

let app: FastifyInstance;
let token: string;

const GROUP_ID = 'group_0000001';
const CALLER_ID = 'user_caller01';
const FRIEND_ID = 'user_friend01';

function groupWithMembers(members: Array<{ userId: string; leftAt: Date | null; role?: string }>) {
  return {
    id: GROUP_ID,
    name: 'Roomies',
    members,
  };
}

function loadedGroupDto() {
  return {
    id: GROUP_ID,
    name: 'Roomies',
    emoji: '🏠',
    type: 'HOME',
    currency: 'USD',
    inviteCode: 'ABCDEFGHIJ',
    simplifyDebts: true,
    createdBy: { id: CALLER_ID, name: 'Caller', avatarColor: '#111' },
    members: [],
    archivedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

beforeEach(async () => {
  groupMemberFindFirstMock.mockReset();
  friendshipFindUniqueMock.mockReset();
  groupFindUniqueMock.mockReset();
  groupFindUniqueOrThrowMock.mockReset();
  groupMemberUpsertMock.mockReset();
  userFindUniqueOrThrowMock.mockReset();
  recordActivityMock.mockClear();
  ensureFriendshipsAmongMock.mockClear();
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: CALLER_ID });
});

afterEach(async () => {
  await app.close();
});

describe('POST /api/v1/groups/:groupId/members/by-friend', () => {
  it('requires authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/members/by-friend`,
      payload: { userId: FRIEND_ID },
    });
    expect(res.statusCode).toBe(401);
  });

  it('404s a caller who is not an active member', async () => {
    groupMemberFindFirstMock.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/members/by-friend`,
      headers: { authorization: `Bearer ${token}` },
      payload: { userId: FRIEND_ID },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('403s NOT_FRIENDS when no Friendship row exists between caller and target', async () => {
    groupMemberFindFirstMock.mockResolvedValue({ role: 'MEMBER' });
    friendshipFindUniqueMock.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/members/by-friend`,
      headers: { authorization: `Bearer ${token}` },
      payload: { userId: FRIEND_ID },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('NOT_FRIENDS');
    expect(groupMemberUpsertMock).not.toHaveBeenCalled();
  });

  it('is idempotent when the friend is already an active member (no side effects)', async () => {
    groupMemberFindFirstMock.mockResolvedValue({ role: 'MEMBER' });
    friendshipFindUniqueMock.mockResolvedValue({ userAId: CALLER_ID, userBId: FRIEND_ID });
    groupFindUniqueOrThrowMock.mockResolvedValue(
      groupWithMembers([
        { userId: CALLER_ID, leftAt: null },
        { userId: FRIEND_ID, leftAt: null },
      ]),
    );
    groupFindUniqueMock.mockResolvedValue(loadedGroupDto());

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/members/by-friend`,
      headers: { authorization: `Bearer ${token}` },
      payload: { userId: FRIEND_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(groupMemberUpsertMock).not.toHaveBeenCalled();
    expect(ensureFriendshipsAmongMock).not.toHaveBeenCalled();
    expect(recordActivityMock).not.toHaveBeenCalled();
  });

  it('adds the friend, running the same add-member side effects as the email path', async () => {
    groupMemberFindFirstMock.mockResolvedValue({ role: 'MEMBER' });
    friendshipFindUniqueMock.mockResolvedValue({ userAId: CALLER_ID, userBId: FRIEND_ID });
    groupFindUniqueOrThrowMock.mockResolvedValue(
      groupWithMembers([{ userId: CALLER_ID, leftAt: null, role: 'ADMIN' }]),
    );
    groupMemberUpsertMock.mockResolvedValue({});
    userFindUniqueOrThrowMock.mockResolvedValue({
      id: CALLER_ID,
      name: 'Caller',
      avatarColor: '#111',
    });
    groupFindUniqueMock.mockResolvedValue(loadedGroupDto());

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${GROUP_ID}/members/by-friend`,
      headers: { authorization: `Bearer ${token}` },
      payload: { userId: FRIEND_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(groupMemberUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { groupId_userId: { groupId: GROUP_ID, userId: FRIEND_ID } },
      }),
    );
    expect(ensureFriendshipsAmongMock).toHaveBeenCalledWith([CALLER_ID, FRIEND_ID]);
    expect(recordActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'MEMBER_JOINED',
        groupId: GROUP_ID,
        notify: expect.objectContaining({ type: 'ADDED_TO_GROUP' }),
      }),
    );
  });
});
