// WI-035 (avatarUrl on PATCH /users/me) + WI-041 (notification preferences,
// auth's slice) — DRB-approved with conditions.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const userUpdateMock = vi.fn();
const notificationPreferenceFindManyMock = vi.fn();
const notificationPreferenceUpsertMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: {
      update: (...args: unknown[]) => userUpdateMock(...args),
    },
    notificationPreference: {
      findMany: (...args: unknown[]) => notificationPreferenceFindManyMock(...args),
      upsert: (...args: unknown[]) => notificationPreferenceUpsertMock(...args),
    },
  },
}));

import { buildApp } from '../src/app';

let app: FastifyInstance;
let token: string;
const USER_ID = 'user_1';

function baseUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: USER_ID,
    email: 'sam@example.com',
    passwordHash: 'hash',
    name: 'Sam',
    avatarColor: '#2a78d6',
    avatarUrl: null,
    defaultCurrency: 'USD',
    emailNotifications: true,
    staleBalanceRemindersEnabled: false,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(async () => {
  userUpdateMock.mockReset();
  notificationPreferenceFindManyMock.mockReset();
  notificationPreferenceUpsertMock.mockReset();
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: USER_ID });
});

afterEach(async () => {
  await app.close();
});

describe('PATCH /api/v1/users/me — avatarUrl (WI-035)', () => {
  it('sets avatarUrl when given a valid /uploads/avatars path', async () => {
    const url = '/uploads/avatars/0123456789abcdef0123456789abcdef.jpg';
    userUpdateMock.mockResolvedValue(baseUser({ avatarUrl: url }));
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarUrl: url },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().avatarUrl).toBe(url);
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { avatarUrl: url },
    });
  });

  it('clears avatarUrl with explicit null, idempotently', async () => {
    userUpdateMock.mockResolvedValue(baseUser({ avatarUrl: null }));
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarUrl: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().avatarUrl).toBeNull();
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { avatarUrl: null },
    });
  });

  it('leaves avatarUrl untouched when omitted from the payload', async () => {
    userUpdateMock.mockResolvedValue(baseUser({ name: 'Sam2' }));
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Sam2' },
    });
    expect(res.statusCode).toBe(200);
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { name: 'Sam2' },
    });
  });

  it('rejects an external URL with a 400 (server-side validation, blocking DRB security condition)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarUrl: 'https://evil.com/track.png' },
    });
    expect(res.statusCode).toBe(400);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects a path into a different /uploads subdirectory', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarUrl: '/uploads/receipts/0123456789abcdef0123456789abcdef.jpg' },
    });
    expect(res.statusCode).toBe(400);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/users/me/notification-preferences (WI-041)', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users/me/notification-preferences' });
    expect(res.statusCode).toBe(401);
  });

  it('returns all 9 canonical categories with absent rows resolved to both channels on', async () => {
    notificationPreferenceFindManyMock.mockResolvedValue([]);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me/notification-preferences',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      categories: Array<{ category: string; pushEnabled: boolean; emailEnabled: boolean; available: boolean }>;
    }>();
    expect(body.categories).toHaveLength(9);
    for (const c of body.categories) {
      expect(c.pushEnabled).toBe(true);
      expect(c.emailEnabled).toBe(true);
    }
    const byCategory = Object.fromEntries(body.categories.map((c) => [c.category, c]));
    expect(byCategory.EXPENSE_ADDED?.available).toBe(true);
    expect(byCategory.PRODUCT_NEWS?.available).toBe(false);
    expect(byCategory.MONTHLY_SUMMARY?.available).toBe(false);
    expect(byCategory.EXPENSE_DUE?.available).toBe(false);
    // Only the authenticated caller's rows are ever read (IDOR guard).
    expect(notificationPreferenceFindManyMock).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
  });

  it('applies a stored row over the default for the category it covers, leaving others at default', async () => {
    notificationPreferenceFindManyMock.mockResolvedValue([
      { userId: USER_ID, category: 'COMMENT', pushEnabled: false, emailEnabled: true },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me/notification-preferences',
      headers: { authorization: `Bearer ${token}` },
    });
    const body = res.json<{ categories: Array<{ category: string; pushEnabled: boolean; emailEnabled: boolean }> }>();
    const comment = body.categories.find((c) => c.category === 'COMMENT');
    expect(comment).toEqual({ category: 'COMMENT', pushEnabled: false, emailEnabled: true, available: true });
    const added = body.categories.find((c) => c.category === 'EXPENSE_ADDED');
    expect(added).toEqual({ category: 'EXPENSE_ADDED', pushEnabled: true, emailEnabled: true, available: true });
  });
});

describe('PATCH /api/v1/users/me/notification-preferences (WI-041)', () => {
  it('requires authentication', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me/notification-preferences',
      payload: { preferences: [{ category: 'COMMENT', pushEnabled: false }] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('upserts each cell scoped to request.userId — never a userId from the body (IDOR guard)', async () => {
    notificationPreferenceUpsertMock.mockResolvedValue({});
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me/notification-preferences',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        preferences: [
          // Even if a client smuggles a userId in, it must be ignored/stripped by zod.
          { category: 'COMMENT', userId: 'user_attacker', pushEnabled: false },
        ],
      },
    });
    expect(res.statusCode).toBe(204);
    expect(notificationPreferenceUpsertMock).toHaveBeenCalledTimes(1);
    const call = notificationPreferenceUpsertMock.mock.calls[0]?.[0];
    expect(call.where).toEqual({ userId_category: { userId: USER_ID, category: 'COMMENT' } });
    expect(call.create.userId).toBe(USER_ID);
    expect(call.update).toEqual({ pushEnabled: false });
  });

  it('rejects an unknown category with 400 (never silently dropped)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me/notification-preferences',
      headers: { authorization: `Bearer ${token}` },
      payload: { preferences: [{ category: 'NOT_A_CATEGORY', pushEnabled: true }] },
    });
    expect(res.statusCode).toBe(400);
    expect(notificationPreferenceUpsertMock).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean channel value with 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me/notification-preferences',
      headers: { authorization: `Bearer ${token}` },
      payload: { preferences: [{ category: 'COMMENT', pushEnabled: 'nope' }] },
    });
    expect(res.statusCode).toBe(400);
    expect(notificationPreferenceUpsertMock).not.toHaveBeenCalled();
  });

  it('accepts multiple cells in one call and upserts each independently', async () => {
    notificationPreferenceUpsertMock.mockResolvedValue({});
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me/notification-preferences',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        preferences: [
          { category: 'COMMENT', pushEnabled: false },
          { category: 'GROUP_INVITE', emailEnabled: false },
        ],
      },
    });
    expect(res.statusCode).toBe(204);
    expect(notificationPreferenceUpsertMock).toHaveBeenCalledTimes(2);
  });
});
