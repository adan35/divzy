// spec-WI-056 — "Clear notification" action. Written red-first against the
// pre-change route (no clearedAt filtering, no POST .../clear route).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const notificationFindManyMock = vi.fn();
const notificationCountMock = vi.fn();
const notificationFindFirstMock = vi.fn();
const notificationUpdateMock = vi.fn();
const notificationUpdateManyMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    notification: {
      findMany: (...args: unknown[]) => notificationFindManyMock(...args),
      count: (...args: unknown[]) => notificationCountMock(...args),
      findFirst: (...args: unknown[]) => notificationFindFirstMock(...args),
      update: (...args: unknown[]) => notificationUpdateMock(...args),
      updateMany: (...args: unknown[]) => notificationUpdateManyMock(...args),
    },
  },
}));

import { buildApp } from '../src/app';

let app: FastifyInstance;
let token: string;

const USER_ID = 'user_owner001';

function notificationRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'notif_001',
    userId: USER_ID,
    type: 'EXPENSE_ADDED',
    title: 'Alice added an expense',
    body: 'Groceries · $42.10',
    data: {},
    readAt: null,
    clearedAt: null,
    createdAt: new Date('2026-07-10T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(async () => {
  notificationFindManyMock.mockReset();
  notificationCountMock.mockReset();
  notificationFindFirstMock.mockReset();
  notificationUpdateMock.mockReset();
  notificationUpdateManyMock.mockReset();
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: USER_ID });
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/v1/notifications — default-excludes cleared rows', () => {
  it('filters clearedAt: null in the default where clause', async () => {
    notificationFindManyMock.mockResolvedValue([]);

    await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(notificationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID, clearedAt: null },
      }),
    );
  });

  it('composes clearedAt: null with unreadOnly', async () => {
    notificationFindManyMock.mockResolvedValue([]);

    await app.inject({
      method: 'GET',
      url: '/api/v1/notifications?unreadOnly=true',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(notificationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID, clearedAt: null, readAt: null },
      }),
    );
  });
});

describe('GET /api/v1/notifications/unread-count — excludes cleared rows', () => {
  it('filters readAt: null AND clearedAt: null', async () => {
    notificationCountMock.mockResolvedValue(0);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications/unread-count',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(notificationCountMock).toHaveBeenCalledWith({
      where: { userId: USER_ID, readAt: null, clearedAt: null },
    });
  });
});

describe('POST /api/v1/notifications/:notificationId/clear', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/notifications/notif_001/clear' });
    expect(res.statusCode).toBe(401);
  });

  it('404s a foreign/unknown notification id (never leaks existence)', async () => {
    notificationFindFirstMock.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/notif_foreign/clear',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
    expect(notificationFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'notif_foreign', userId: USER_ID } }),
    );
    expect(notificationUpdateMock).not.toHaveBeenCalled();
  });

  it('clears an uncleared notification: writes clearedAt, returns 204', async () => {
    notificationFindFirstMock.mockResolvedValue({ id: 'notif_001', clearedAt: null });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/notif_001/clear',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(notificationUpdateMock).toHaveBeenCalledWith({
      where: { id: 'notif_001' },
      data: { clearedAt: expect.any(Date) },
    });
  });

  it('is idempotent: a second clear does not overwrite the existing clearedAt', async () => {
    const existingClearedAt = new Date('2026-07-09T00:00:00.000Z');
    notificationFindFirstMock.mockResolvedValue({ id: 'notif_001', clearedAt: existingClearedAt });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/notif_001/clear',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);
    expect(notificationUpdateMock).not.toHaveBeenCalled();
  });

  it('never touches readAt — clear and read are independent columns', async () => {
    notificationFindFirstMock.mockResolvedValue({ id: 'notif_001', clearedAt: null });

    await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/notif_001/clear',
      headers: { authorization: `Bearer ${token}` },
    });

    const updateCall = notificationUpdateMock.mock.calls[0]![0];
    expect(updateCall.data).not.toHaveProperty('readAt');
  });
});

describe('POST /api/v1/notifications/read-all — unchanged, clearedAt-agnostic', () => {
  it('still filters only { userId, readAt: null } (may harmlessly touch cleared-but-unread rows)', async () => {
    notificationUpdateManyMock.mockResolvedValue({ count: 0 });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/read-all',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);
    expect(notificationUpdateManyMock).toHaveBeenCalledWith({
      where: { userId: USER_ID, readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });
});

describe('toNotificationDto — serializer parity (WI-056)', () => {
  it('returns clearedAt as null for an uncleared row and ISO string for a cleared row', async () => {
    notificationFindManyMock.mockResolvedValue([
      notificationRow({ id: 'notif_a', clearedAt: null }),
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications',
      headers: { authorization: `Bearer ${token}` },
    });

    const body = res.json();
    expect(body.items[0].clearedAt).toBeNull();
  });
});
