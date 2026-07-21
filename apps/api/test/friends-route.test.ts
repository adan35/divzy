import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const userFindUniqueMock = vi.fn();
const friendshipFindManyMock = vi.fn();
const friendshipFindUniqueMock = vi.fn();
const friendshipCreateManyMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const exchangeRateCacheFindUniqueMock = vi.fn();
const exchangeRateCacheUpsertMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    friendship: {
      findMany: (...args: unknown[]) => friendshipFindManyMock(...args),
      findUnique: (...args: unknown[]) => friendshipFindUniqueMock(...args),
      createMany: (...args: unknown[]) => friendshipCreateManyMock(...args),
    },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: { findMany: (...args: unknown[]) => settlementFindManyMock(...args) },
    exchangeRateCache: {
      findUnique: (...args: unknown[]) => exchangeRateCacheFindUniqueMock(...args),
      upsert: (...args: unknown[]) => exchangeRateCacheUpsertMock(...args),
    },
  },
}));

// Simulates drift between the 52 supported currencies and the bundled fallback
// table (same technique as rates-unavailable.test.ts) so a nominally-supported
// code (PKR) can still hit true RATE_UNAVAILABLE end-to-end.
vi.mock('../src/lib/rates-fallback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/rates-fallback')>();
  const { PKR: _omitted, ...rest } = actual.FALLBACK_RATES;
  return { FALLBACK_RATES: rest };
});

import { buildApp } from '../src/app';
import { resetCacheForTests } from '../src/lib/cache';

let app: FastifyInstance;
let token: string;

function freshCacheRow(base: string, rates: Record<string, number>) {
  return { id: 'cache_1', base, rates, fetchedAt: new Date() };
}

function friendUser(id: string, name: string) {
  return { id, name, avatarColor: '#fff' };
}

beforeEach(async () => {
  userFindUniqueMock.mockReset();
  friendshipFindManyMock.mockReset();
  friendshipFindUniqueMock.mockReset();
  friendshipCreateManyMock.mockReset().mockResolvedValue({ count: 1 });
  expenseFindManyMock.mockReset();
  settlementFindManyMock.mockReset();
  exchangeRateCacheFindUniqueMock.mockReset();
  exchangeRateCacheUpsertMock.mockReset();
  // WI-070: GET /friends is now wrapped in the process-wide response cache
  // (same as GET /balance since WI-067), keyed on this fixed userId with no
  // query params — every it() below must start from a cold cache, otherwise
  // a later test's mock reconfiguration would never be observed.
  resetCacheForTests();
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: 'user_1' });
});

afterEach(async () => {
  await app.close();
});

// story-WI-001 (social-groups) — GET /friends addendum (2026-07-14) scenarios ------

describe('GET /api/v1/friends', () => {
  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/friends' });
    expect(res.statusCode).toBe(401);
  });

  it('collapses a multi-currency friend balance to one converted figure (Friends list and friend detail collapse a multi-currency balance to one converted figure)', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    friendshipFindManyMock.mockResolvedValue([
      {
        userAId: 'user_1',
        userBId: 'sam',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        userA: friendUser('user_1', 'Me'),
        userB: friendUser('sam', 'Sam'),
      },
    ]);
    expenseFindManyMock.mockResolvedValue([
      {
        currency: 'USD',
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
        payers: [{ userId: 'sam', amount: 5000 }],
        splits: [
          { userId: 'user_1', amount: 5000 },
          { userId: 'sam', amount: 0 },
        ],
      },
      {
        currency: 'EUR',
        createdAt: new Date('2026-07-03T00:00:00.000Z'),
        payers: [{ userId: 'sam', amount: 3000 }],
        splits: [
          { userId: 'user_1', amount: 3000 },
          { userId: 'sam', amount: 0 },
        ],
      },
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(
      freshCacheRow('GBP', { GBP: 1, USD: 1 / 0.79, EUR: 1 / 0.86 }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const [sam] = res.json();
    expect(sam.user.id).toBe('sam');
    expect(sam.balances).toEqual([]);
    expect(sam.balancesConverted).toEqual({ currency: 'GBP', amount: -6530 }); // "You owe £65.30"
    expect(sam.usedFallbackRates).toBe(false);
    expect(exchangeRateCacheFindUniqueMock).toHaveBeenCalledTimes(1); // one resolveConversionRates call, batched
  });

  it('falls back to the native leftover line when a friend balance currency has no resolvable rate', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    friendshipFindManyMock.mockResolvedValue([
      {
        userAId: 'user_1',
        userBId: 'sam',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        userA: friendUser('user_1', 'Me'),
        userB: friendUser('sam', 'Sam'),
      },
    ]);
    expenseFindManyMock.mockResolvedValue([
      {
        currency: 'PKR',
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
        payers: [{ userId: 'sam', amount: 100000 }],
        splits: [
          { userId: 'user_1', amount: 100000 },
          { userId: 'sam', amount: 0 },
        ],
      },
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('GBP', { GBP: 1 }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const [sam] = res.json();
    expect(sam.balances).toEqual([{ currency: 'PKR', amount: -100000 }]);
    expect(sam.balancesConverted).toBeNull();
    // Genuinely unresolvable (even the bundled fallback table has no PKR entry in
    // this test, see the module-level rates-fallback mock above) — no fallback rate
    // was actually *used*, so usedFallbackRates correctly stays false here.
    expect(sam.usedFallbackRates).toBe(false);
  });

  it('flags usedFallbackRates when a friend balance currency needed the bundled fallback rate table but still resolved', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    friendshipFindManyMock.mockResolvedValue([
      {
        userAId: 'user_1',
        userBId: 'sam',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        userA: friendUser('user_1', 'Me'),
        userB: friendUser('sam', 'Sam'),
      },
    ]);
    expenseFindManyMock.mockResolvedValue([
      {
        currency: 'INR', // present in the bundled fallback table, absent from the live/cached map below
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
        payers: [{ userId: 'sam', amount: 100000 }],
        splits: [
          { userId: 'user_1', amount: 100000 },
          { userId: 'sam', amount: 0 },
        ],
      },
    ]);
    settlementFindManyMock.mockResolvedValue([]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('GBP', { GBP: 1 }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const [sam] = res.json();
    expect(sam.balances).toEqual([]); // resolved via fallback table, not a leftover
    expect(sam.balancesConverted).not.toBeNull();
    expect(sam.usedFallbackRates).toBe(true);
  });

  it('orders friends by converted balance magnitude (biggest first), not by the narrowed native-leftover list', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    friendshipFindManyMock.mockResolvedValue([
      {
        userAId: 'user_1',
        userBId: 'small',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        userA: friendUser('user_1', 'Me'),
        userB: friendUser('small', 'Small Balance'),
      },
      {
        userAId: 'user_1',
        userBId: 'big',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        userA: friendUser('user_1', 'Me'),
        userB: friendUser('big', 'Big Balance'),
      },
    ]);
    expenseFindManyMock.mockResolvedValue([
      {
        currency: 'USD',
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
        payers: [{ userId: 'small', amount: 1000 }],
        splits: [
          { userId: 'user_1', amount: 1000 },
          { userId: 'small', amount: 0 },
        ],
      },
      {
        currency: 'USD',
        createdAt: new Date('2026-07-02T00:00:00.000Z'),
        payers: [{ userId: 'big', amount: 90000 }],
        splits: [
          { userId: 'user_1', amount: 90000 },
          { userId: 'big', amount: 0 },
        ],
      },
    ]);
    // A settlement also exercises the settlement-side pairwise bump + lastSharedAt branches.
    settlementFindManyMock.mockResolvedValue([
      {
        currency: 'USD',
        fromUserId: 'user_1',
        toUserId: 'small',
        amount: 200,
        createdAt: new Date('2026-07-05T00:00:00.000Z'),
      },
    ]);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(
      freshCacheRow('GBP', { GBP: 1, USD: 1 / 0.79 }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const names = res.json().map((f: { user: { name: string } }) => f.user.name);
    expect(names).toEqual(['Big Balance', 'Small Balance']);
  });

  it('shows a settled-up friend (empty balances, null converted) rather than "£0.00"', async () => {
    userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
    friendshipFindManyMock.mockResolvedValue([
      {
        userAId: 'user_1',
        userBId: 'sam',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        userA: friendUser('user_1', 'Me'),
        userB: friendUser('sam', 'Sam'),
      },
    ]);
    expenseFindManyMock.mockResolvedValue([]);
    settlementFindManyMock.mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const [sam] = res.json();
    expect(sam.balances).toEqual([]);
    expect(sam.balancesConverted).toBeNull();
  });
});

describe('POST /api/v1/friends', () => {
  it('returns balancesConverted: null and usedFallbackRates: false for a newly-created friendship with no shared ledger yet', async () => {
    userFindUniqueMock
      .mockResolvedValueOnce(friendUser('sam', 'Sam')) // target lookup by email
      .mockResolvedValueOnce({ name: 'Me' }); // actor lookup for activity
    friendshipFindUniqueMock.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
      payload: { identifier: 'sam@example.com' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.balances).toEqual([]);
    expect(body.balancesConverted).toBeNull();
    expect(body.usedFallbackRates).toBe(false);
  });

  // story-WI-045 (social-groups) — add friend by phone number ------------------

  it('finds and adds a friend by a phone-shaped identifier', async () => {
    userFindUniqueMock
      .mockResolvedValueOnce(friendUser('sam', 'Sam')) // target lookup by phone
      .mockResolvedValueOnce({ name: 'Me' }); // actor lookup for activity
    friendshipFindUniqueMock.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
      payload: { identifier: '+14155552671' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.id).toBe('sam');
    // The route branches to exactly one targeted findUnique on `phone`, never `email`.
    expect(userFindUniqueMock).toHaveBeenNthCalledWith(1, {
      where: { phone: '+14155552671' },
      select: { id: true, name: true, avatarColor: true, avatarUrl: true },
    });
  });

  it('normalizes a formatted phone number before the lookup (zPhone strips spaces/hyphens)', async () => {
    userFindUniqueMock
      .mockResolvedValueOnce(friendUser('sam', 'Sam'))
      .mockResolvedValueOnce({ name: 'Me' });
    friendshipFindUniqueMock.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
      payload: { identifier: '+1 415-555-2671' },
    });

    expect(res.statusCode).toBe(201);
    expect(userFindUniqueMock).toHaveBeenNthCalledWith(1, {
      where: { phone: '+14155552671' },
      select: { id: true, name: true, avatarColor: true, avatarUrl: true },
    });
  });

  it('returns 404 USER_NOT_FOUND when no account matches the phone identifier', async () => {
    userFindUniqueMock.mockResolvedValueOnce(null); // target lookup by phone — no match

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
      payload: { identifier: '+14155552671' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('USER_NOT_FOUND');
    // Same shape/code as the email-not-found case — only one lookup attempted.
    expect(userFindUniqueMock).toHaveBeenCalledTimes(1);
  });

  it('returns a 400 validation error for an identifier matching neither email nor phone shape, before any DB lookup', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
      payload: { identifier: 'not-an-identifier' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    // Schema-level pre-lookup rejection — no account-existence info can leak.
    expect(userFindUniqueMock).not.toHaveBeenCalled();
  });

  it('returns 400 CANNOT_ADD_SELF when the phone identifier resolves to the caller\'s own account', async () => {
    userFindUniqueMock.mockResolvedValueOnce({ id: 'user_1', name: 'Me', avatarColor: '#fff' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
      payload: { identifier: '+14155552671' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('CANNOT_ADD_SELF');
  });

  it('is idempotent for a phone-based re-add of an already-existing friend (no duplicate activity)', async () => {
    userFindUniqueMock.mockResolvedValueOnce(friendUser('sam', 'Sam')); // target lookup only
    friendshipFindUniqueMock.mockResolvedValue({
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
      payload: { identifier: '+14155552671' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.id).toBe('sam');
    expect(body.lastActivityAt).toBe('2026-01-01T00:00:00.000Z');
    // The actor-lookup + FRIEND_ADDED activity path only runs for genuinely NEW
    // friendships (addFriendPair's `if (!existing)` branch) — a second
    // userFindUniqueMock call here would mean that branch fired again.
    expect(userFindUniqueMock).toHaveBeenCalledTimes(1);
  });

  it('never echoes a phone number anywhere in the add-friend response body (regression guard)', async () => {
    const PHONE = '+14155552671';
    // Simulate a Prisma row that (hypothetically, if the select regressed) carries a
    // `phone` value, to prove the leak-guard is toPublicUser's explicit field pick,
    // not just today's publicUserSelect shape.
    userFindUniqueMock
      .mockResolvedValueOnce({ id: 'sam', name: 'Sam', avatarColor: '#fff', avatarUrl: null, phone: PHONE })
      .mockResolvedValueOnce({ name: 'Me' });
    friendshipFindUniqueMock.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/friends',
      headers: { authorization: `Bearer ${token}` },
      payload: { identifier: PHONE },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user).not.toHaveProperty('phone');
    expect(JSON.stringify(body)).not.toContain(PHONE);
  });
});
