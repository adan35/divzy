// WI-045 (ADR-024, auth's slice) — phone as a second login identifier
// (POST /auth/login), phone-settable PATCH /users/me (with PHONE_TAKEN 409 on
// P2002), and phone-aware GET /users/search (never selecting/returning phone).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';

const userFindUniqueMock = vi.fn();
const userUpdateMock = vi.fn();
const userCountMock = vi.fn();
const refreshTokenCreateMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
      update: (...args: unknown[]) => userUpdateMock(...args),
      count: (...args: unknown[]) => userCountMock(...args),
    },
    refreshToken: {
      create: (...args: unknown[]) => refreshTokenCreateMock(...args),
    },
  },
}));

vi.mock('../src/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/auth')>();
  return {
    ...actual,
    verifyPassword: vi.fn(async (_hash: string, password: string) => password === 'correct-password'),
    issueAuthTokens: vi.fn(async () => ({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessTokenExpiresIn: 900,
    })),
  };
});

import { buildApp } from '../src/app';

let app: FastifyInstance;
const USER_ID = 'user_1';

function baseUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: USER_ID,
    email: 'sam@example.com',
    phone: null,
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

let token: string;

beforeEach(async () => {
  userFindUniqueMock.mockReset();
  userUpdateMock.mockReset();
  userCountMock.mockReset();
  refreshTokenCreateMock.mockReset();
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: USER_ID });
});

afterEach(async () => {
  await app.close();
});

describe('POST /api/v1/auth/login — phone identifier (WI-045)', () => {
  it('logs in with a valid phone identifier + correct password', async () => {
    userFindUniqueMock.mockResolvedValue(baseUser({ phone: '+14155552671' }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { identifier: '+1 415-555-2671', password: 'correct-password' },
    });
    expect(res.statusCode).toBe(200);
    expect(userFindUniqueMock).toHaveBeenCalledWith({ where: { phone: '+14155552671' } });
    expect(res.json().user.phone).toBe('+14155552671');
  });

  it('still logs in with an email identifier (unchanged path)', async () => {
    userFindUniqueMock.mockResolvedValue(baseUser());
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { identifier: 'sam@example.com', password: 'correct-password' },
    });
    expect(res.statusCode).toBe(200);
    expect(userFindUniqueMock).toHaveBeenCalledWith({ where: { email: 'sam@example.com' } });
  });

  it('returns identical 401 INVALID_CREDENTIALS for an unknown phone (no enumeration)', async () => {
    userFindUniqueMock.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { identifier: '+14155552671', password: 'whatever' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_CREDENTIALS');
  });

  it('returns identical 401 INVALID_CREDENTIALS for a known phone + wrong password', async () => {
    userFindUniqueMock.mockResolvedValue(baseUser({ phone: '+14155552671' }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { identifier: '+14155552671', password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_CREDENTIALS');
  });

  it('returns identical 401 INVALID_CREDENTIALS for an unknown email (email path unchanged)', async () => {
    userFindUniqueMock.mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { identifier: 'nobody@example.com', password: 'whatever' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_CREDENTIALS');
  });

  it('runs exactly one findUnique lookup per login attempt (never both email and phone)', async () => {
    userFindUniqueMock.mockResolvedValue(baseUser({ phone: '+14155552671' }));
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { identifier: '+14155552671', password: 'correct-password' },
    });
    expect(userFindUniqueMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an identifier matching neither email nor phone shape with 400, never reaching the DB', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { identifier: 'not-an-identifier', password: 'whatever' },
    });
    expect(res.statusCode).toBe(400);
    expect(userFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/v1/users/me — phone (WI-045)', () => {
  it('sets phone when given a valid E.164 number', async () => {
    userUpdateMock.mockResolvedValue(baseUser({ phone: '+14155552671' }));
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { phone: '+14155552671' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().phone).toBe('+14155552671');
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { phone: '+14155552671' },
    });
  });

  it('clears phone with explicit null, idempotently', async () => {
    userUpdateMock.mockResolvedValue(baseUser({ phone: null }));
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { phone: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().phone).toBeNull();
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { phone: null },
    });
  });

  it('leaves phone untouched when omitted from the payload', async () => {
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

  it('rejects a malformed phone with 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { phone: 'not-a-phone' },
    });
    expect(res.statusCode).toBe(400);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('maps a P2002 unique-constraint race on phone to 409 PHONE_TAKEN', async () => {
    userUpdateMock.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.0.0',
        meta: { target: ['phone'] },
      }),
    );
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { phone: '+14155552671' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('PHONE_TAKEN');
  });

  it('rethrows a non-P2002 error unchanged (500)', async () => {
    userUpdateMock.mockRejectedValue(new Error('boom'));
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { phone: '+14155552671' },
    });
    expect(res.statusCode).toBe(500);
  });
});

describe('GET /api/v1/users/search — phone (WI-045)', () => {
  it('looks up by phone when phone= is provided', async () => {
    userFindUniqueMock.mockResolvedValue({
      id: 'user_2',
      name: 'Alex',
      avatarColor: '#fff',
      avatarUrl: null,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/search?phone=%2B14155552671',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { phone: '+14155552671' },
      select: { id: true, name: true, avatarColor: true, avatarUrl: true },
    });
    // Never leaks phone on the public surface, even though it was searched by.
    expect(res.json().phone).toBeUndefined();
  });

  it('returns JSON null on no match by phone', async () => {
    userFindUniqueMock.mockResolvedValue(null);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/search?phone=%2B14155552671',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it('still looks up by email when email= is provided (unchanged path)', async () => {
    userFindUniqueMock.mockResolvedValue(null);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/search?email=sam@example.com',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { email: 'sam@example.com' },
      select: { id: true, name: true, avatarColor: true, avatarUrl: true },
    });
  });

  it('rejects a query with neither email nor phone with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/search',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    expect(userFindUniqueMock).not.toHaveBeenCalled();
  });

  it('rejects a query with both email and phone with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/search?email=sam@example.com&phone=%2B14155552671',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    expect(userFindUniqueMock).not.toHaveBeenCalled();
  });
});
