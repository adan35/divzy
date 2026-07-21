import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const upsertMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    manualExchangeRate: {
      upsert: (...args: unknown[]) => upsertMock(...args),
    },
  },
}));

import { buildApp } from '../src/app';

let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  upsertMock.mockReset();
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: 'user_1' });
});

afterEach(async () => {
  await app.close();
});

// story-WI-002 (analytics) scenarios ------------------------------------------------

describe('POST /api/v1/rates/manual', () => {
  it('requires authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rates/manual',
      payload: { from: 'USD', to: 'PKR', rate: 278.5 },
    });

    expect(res.statusCode).toBe(401);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('persists the rate against request.userId, never a caller-supplied user id (Manual rate is persisted and used)', async () => {
    upsertMock.mockResolvedValue({
      id: 'm1',
      userId: 'user_1',
      fromCurrency: 'USD',
      toCurrency: 'PKR',
      rate: 278.5,
      createdAt: new Date('2026-07-13T00:00:00.000Z'),
      updatedAt: new Date('2026-07-13T00:00:00.000Z'),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rates/manual',
      headers: { authorization: `Bearer ${token}` },
      // 'userId' is not part of the request contract; even if a caller sends one it
      // must never reach the persisted row — only request.userId (from the JWT) may.
      payload: { from: 'usd', to: 'pkr', rate: 278.5, userId: 'someone_else' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ from: 'USD', to: 'PKR', rate: 278.5, createdAt: '2026-07-13T00:00:00.000Z' });
    expect(upsertMock).toHaveBeenCalledWith({
      where: {
        userId_fromCurrency_toCurrency: { userId: 'user_1', fromCurrency: 'USD', toCurrency: 'PKR' },
      },
      create: { userId: 'user_1', fromCurrency: 'USD', toCurrency: 'PKR', rate: 278.5 },
      update: { rate: 278.5 },
    });
  });

  it('rejects an unsupported currency code (400 UNSUPPORTED_CURRENCY)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rates/manual',
      headers: { authorization: `Bearer ${token}` },
      payload: { from: 'XXX', to: 'PKR', rate: 1 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('UNSUPPORTED_CURRENCY');
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rejects from === to (400 VALIDATION_ERROR, Manual rate input validation)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rates/manual',
      headers: { authorization: `Bearer ${token}` },
      payload: { from: 'USD', to: 'USD', rate: 1 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rejects a zero or negative rate (400 VALIDATION_ERROR, Manual rate input validation)', async () => {
    for (const rate of [0, -5]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/rates/manual',
        headers: { authorization: `Bearer ${token}` },
        payload: { from: 'USD', to: 'PKR', rate },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    }
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric rate (400 VALIDATION_ERROR, Manual rate input validation)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rates/manual',
      headers: { authorization: `Bearer ${token}` },
      payload: { from: 'USD', to: 'PKR', rate: 'a lot' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('overwrites (upserts) rather than erroring on a resubmission for the same pair', async () => {
    upsertMock.mockResolvedValue({
      id: 'm1',
      userId: 'user_1',
      fromCurrency: 'USD',
      toCurrency: 'PKR',
      rate: 280,
      createdAt: new Date('2026-07-13T00:00:00.000Z'),
      updatedAt: new Date('2026-07-14T00:00:00.000Z'),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rates/manual',
      headers: { authorization: `Bearer ${token}` },
      payload: { from: 'USD', to: 'PKR', rate: 280 },
    });

    expect(res.statusCode).toBe(200);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { rate: 280 },
      }),
    );
  });
});
