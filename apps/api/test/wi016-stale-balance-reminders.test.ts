import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// story-WI-016 (reminders half, auth slice) — `User.staleBalanceRemindersEnabled`
// preference. Mirrors the existing `emailNotifications` field one-for-one
// (spec-WI-016 §1); these tests cover the 9 Gherkin scenarios in
// story-WI-016.md at the HTTP level.

const userUpdateMock = vi.fn();
const userFindUniqueMock = vi.fn();
const userCreateMock = vi.fn();
const userCountMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: {
      update: (...args: unknown[]) => userUpdateMock(...args),
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
      create: (...args: unknown[]) => userCreateMock(...args),
      count: (...args: unknown[]) => userCountMock(...args),
    },
    refreshToken: {
      // issueAuthTokens persists a refresh token row on register/login.
      create: vi.fn().mockResolvedValue({ id: 'rt_1' }),
    },
  },
}));

import { buildApp } from '../src/app';

let app: FastifyInstance;
let token: string;

function baseUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user_1',
    email: 'sam@example.com',
    passwordHash: 'hash',
    name: 'Sam',
    avatarColor: '#2a78d6',
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
  userFindUniqueMock.mockReset();
  userCreateMock.mockReset();
  userCountMock.mockReset().mockResolvedValue(0);
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: 'user_1' });
});

afterEach(async () => {
  await app.close();
});

describe('PATCH /api/v1/users/me — staleBalanceRemindersEnabled', () => {
  it('requires authentication', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      payload: { staleBalanceRemindersEnabled: true },
    });

    expect(res.statusCode).toBe(401);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('opts in via profile update (Opting in via profile update)', async () => {
    userUpdateMock.mockResolvedValue(baseUser({ staleBalanceRemindersEnabled: true }));

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { staleBalanceRemindersEnabled: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().staleBalanceRemindersEnabled).toBe(true);
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: { staleBalanceRemindersEnabled: true },
    });
  });

  it('opts out again (Opting out again)', async () => {
    userUpdateMock.mockResolvedValue(baseUser({ staleBalanceRemindersEnabled: false }));

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { staleBalanceRemindersEnabled: false },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().staleBalanceRemindersEnabled).toBe(false);
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: { staleBalanceRemindersEnabled: false },
    });
  });

  it('leaves the preference untouched on a partial update (Partial update leaves the preference untouched)', async () => {
    userUpdateMock.mockResolvedValue(
      baseUser({ name: 'Sam K', staleBalanceRemindersEnabled: true }),
    );

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Sam K' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().staleBalanceRemindersEnabled).toBe(true);
    expect(res.json().name).toBe('Sam K');
    // The guarded assignment must not send the key at all when omitted from
    // the request body, so it can never clobber the stored value.
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: { name: 'Sam K' },
    });
  });

  it('toggles independently of emailNotifications (Independent of emailNotifications)', async () => {
    userUpdateMock.mockResolvedValue(
      baseUser({ emailNotifications: true, staleBalanceRemindersEnabled: true }),
    );

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { staleBalanceRemindersEnabled: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      staleBalanceRemindersEnabled: true,
      emailNotifications: true,
    });
    // emailNotifications was never part of this request, so it must never be
    // sent to Prisma either — toggling one field never mutates the other.
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: 'user_1' },
      data: { staleBalanceRemindersEnabled: true },
    });
  });

  it('rejects a non-boolean value with 400 and changes nothing (Rejecting an invalid value)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { staleBalanceRemindersEnabled: 'yes' },
    });

    expect(res.statusCode).toBe(400);
    expect(userUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request and changes nothing (Requires authentication)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      payload: { staleBalanceRemindersEnabled: true },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error ?? res.json().code).toBeDefined();
    expect(userUpdateMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/auth/me — staleBalanceRemindersEnabled', () => {
  it('includes the preference in the self-profile response (Reading the preference in one\'s own profile)', async () => {
    userFindUniqueMock.mockResolvedValue(baseUser({ staleBalanceRemindersEnabled: false }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().staleBalanceRemindersEnabled).toBe(false);
  });

  it('reflects a subsequent GET after PATCH opted the user in', async () => {
    userFindUniqueMock.mockResolvedValue(baseUser({ staleBalanceRemindersEnabled: true }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.json().staleBalanceRemindersEnabled).toBe(true);
  });
});

describe('POST /api/v1/auth/register — default value', () => {
  it('does not set staleBalanceRemindersEnabled explicitly, relying on the DB default of false (New users default to opted-out)', async () => {
    userFindUniqueMock.mockResolvedValue(null); // no existing user with this email
    userCreateMock.mockResolvedValue(baseUser({ staleBalanceRemindersEnabled: false }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'sam@example.com', password: 'password123', name: 'Sam' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().user.staleBalanceRemindersEnabled).toBe(false);
    const createArgs = userCreateMock.mock.calls[0][0];
    expect(createArgs.data).not.toHaveProperty('staleBalanceRemindersEnabled');
  });
});

describe('GET /api/v1/users/search — public profile non-leakage', () => {
  it('never includes staleBalanceRemindersEnabled on the PublicUser surface (Never exposed on the public profile surface)', async () => {
    // publicUserSelect only ever selects { id, name, avatarColor }, so a
    // mocked Prisma call under that select cannot return the field even if
    // asked to — this asserts the route's select and the DTO shape stay in
    // sync with that contract.
    userFindUniqueMock.mockResolvedValue({ id: 'sam', name: 'Sam', avatarColor: '#2a78d6' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users/search?email=sam@example.com',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 'sam', name: 'Sam', avatarColor: '#2a78d6' });
    expect(res.json()).not.toHaveProperty('staleBalanceRemindersEnabled');
  });
});
