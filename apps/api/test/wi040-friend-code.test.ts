// WI-040 — persistent, regeneratable per-user friend-add code. Written from
// spec-WI-040.md's API contract + sequence flows, TDD red-first against the
// pre-change routes (none of GET /friends/code, POST /friends/code/rotate,
// POST /friends/add-by-code existed).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const friendCodeFindUniqueMock = vi.fn();
const friendCodeCreateMock = vi.fn();
const friendCodeUpdateMock = vi.fn();
const userFindUniqueMock = vi.fn();
const friendshipFindUniqueMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    friendCode: {
      findUnique: (...args: unknown[]) => friendCodeFindUniqueMock(...args),
      create: (...args: unknown[]) => friendCodeCreateMock(...args),
      update: (...args: unknown[]) => friendCodeUpdateMock(...args),
    },
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    friendship: { findUnique: (...args: unknown[]) => friendshipFindUniqueMock(...args) },
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

const ME = 'user_me_00001';
const TARGET = 'user_target001';

beforeEach(async () => {
  friendCodeFindUniqueMock.mockReset();
  friendCodeCreateMock.mockReset();
  friendCodeUpdateMock.mockReset();
  userFindUniqueMock.mockReset();
  friendshipFindUniqueMock.mockReset();
  recordActivityMock.mockClear();
  ensureFriendshipsAmongMock.mockClear();
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: ME });
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/v1/friends/code', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/friends/code' });
    expect(res.statusCode).toBe(401);
  });

  it('returns the existing code without creating a new one', async () => {
    friendCodeFindUniqueMock.mockResolvedValue({ userId: ME, code: 'ABCDEFGHIJ' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/friends/code',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      code: 'ABCDEFGHIJ',
      shareUrl: expect.stringContaining('/add-friend/ABCDEFGHIJ'),
    });
    expect(friendCodeCreateMock).not.toHaveBeenCalled();
  });

  it('lazily creates a code on first call', async () => {
    friendCodeFindUniqueMock.mockResolvedValue(null);
    friendCodeCreateMock.mockResolvedValue({ userId: ME, code: 'ZZZZZZZZZZ' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/friends/code',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().code).toBe('ZZZZZZZZZZ');
    expect(friendCodeCreateMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/v1/friends/code/rotate', () => {
  it('overwrites the code, invalidating the old value', async () => {
    friendCodeUpdateMock.mockResolvedValue({ userId: ME, code: 'NEWCODE123' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/friends/code/rotate',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().code).toBe('NEWCODE123');
    expect(friendCodeUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: ME } }),
    );
  });
});

describe('POST /api/v1/friends/add-by-code', () => {
  it('requires authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/friends/add-by-code',
      payload: { code: 'ABCDEFGHIJ' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('404s INVALID_CODE for an unknown/regenerated-away code', async () => {
    friendCodeFindUniqueMock.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/friends/add-by-code',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: 'NOPE' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('INVALID_CODE');
  });

  it('404s INVALID_CODE when the code resolves to a deleted (orphaned) user', async () => {
    friendCodeFindUniqueMock.mockResolvedValue({ userId: 'ghost_user_001', code: 'ABCDEFGHIJ' });
    userFindUniqueMock.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/friends/add-by-code',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: 'abcdefghij' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('INVALID_CODE');
  });

  it('400s CANNOT_ADD_SELF when the code resolves to the caller', async () => {
    friendCodeFindUniqueMock.mockResolvedValue({ userId: ME, code: 'ABCDEFGHIJ' });
    userFindUniqueMock.mockResolvedValue({ id: ME, name: 'Me', avatarColor: '#111' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/friends/add-by-code',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: 'ABCDEFGHIJ' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('CANNOT_ADD_SELF');
  });

  it('adds a new friendship and returns 201 FriendDto with empty balances', async () => {
    friendCodeFindUniqueMock.mockResolvedValue({ userId: TARGET, code: 'ABCDEFGHIJ' });
    userFindUniqueMock
      .mockResolvedValueOnce({ id: TARGET, name: 'Target', avatarColor: '#222' }) // target lookup
      .mockResolvedValueOnce({ name: 'Me' }); // actor lookup for activity
    friendshipFindUniqueMock.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/friends/add-by-code',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: 'ABCDEFGHIJ' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.id).toBe(TARGET);
    expect(body.balances).toEqual([]);
    expect(body.balancesNative).toEqual([]);
    expect(ensureFriendshipsAmongMock).toHaveBeenCalledWith([ME, TARGET]);
    expect(recordActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'FRIEND_ADDED' }),
    );
  });

  it('is idempotent (silent, no FRIEND_ADDED activity) for an already-existing friendship', async () => {
    friendCodeFindUniqueMock.mockResolvedValue({ userId: TARGET, code: 'ABCDEFGHIJ' });
    userFindUniqueMock.mockResolvedValueOnce({ id: TARGET, name: 'Target', avatarColor: '#222' });
    friendshipFindUniqueMock.mockResolvedValue({ createdAt: new Date('2026-01-01T00:00:00.000Z') });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/friends/add-by-code',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: 'ABCDEFGHIJ' },
    });

    expect(res.statusCode).toBe(201);
    expect(recordActivityMock).not.toHaveBeenCalled();
  });
});
