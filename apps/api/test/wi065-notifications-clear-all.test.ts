// spec-WI-065 — "Clear all" bulk notification action. Written red-first against
// the pre-change route set (no POST .../clear-all route exists yet).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const notificationUpdateManyMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    notification: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: (...args: unknown[]) => notificationUpdateManyMock(...args),
    },
  },
}));

import { buildApp } from '../src/app';

let app: FastifyInstance;
let token: string;

const USER_ID = 'user_owner001';

beforeEach(async () => {
  notificationUpdateManyMock.mockReset();
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: USER_ID });
});

afterEach(async () => {
  await app.close();
});

describe('POST /api/v1/notifications/clear-all', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/notifications/clear-all' });
    expect(res.statusCode).toBe(401);
  });

  it('bulk-clears every uncleared notification owned by the caller, returns 204 with no body', async () => {
    notificationUpdateManyMock.mockResolvedValue({ count: 3 });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/clear-all',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(notificationUpdateManyMock).toHaveBeenCalledWith({
      where: { userId: USER_ID, clearedAt: null },
      data: { clearedAt: expect.any(Date) },
    });
  });

  it('is owner-scoped by construction — where.userId is always the caller, never another user', async () => {
    notificationUpdateManyMock.mockResolvedValue({ count: 0 });

    await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/clear-all',
      headers: { authorization: `Bearer ${token}` },
    });

    const call = notificationUpdateManyMock.mock.calls[0]![0];
    expect(call.where.userId).toBe(USER_ID);
  });

  it('is idempotent / a safe no-op when there is nothing to clear', async () => {
    notificationUpdateManyMock.mockResolvedValue({ count: 0 });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/clear-all',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);
    expect(notificationUpdateManyMock).toHaveBeenCalledWith({
      where: { userId: USER_ID, clearedAt: null },
      data: { clearedAt: expect.any(Date) },
    });
  });

  it('never touches readAt — clear-all and read stay independent columns', async () => {
    notificationUpdateManyMock.mockResolvedValue({ count: 1 });

    await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/clear-all',
      headers: { authorization: `Bearer ${token}` },
    });

    const call = notificationUpdateManyMock.mock.calls[0]![0];
    expect(call.data).not.toHaveProperty('readAt');
    expect(call.where).not.toHaveProperty('readAt');
  });
});
