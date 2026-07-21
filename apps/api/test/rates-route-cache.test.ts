import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// spec-WI-072 §2 / story regression-test requirement (b) — GET /rates wrapped
// in the shared cached()/cacheKey() response cache (60s TTL), mirroring the
// existing convention for /analytics/summary (wi067-cache-endpoints.test.ts)
// and /rates/manual (rates-manual-route.test.ts): mock only
// prisma.exchangeRateCache.findUnique, drive the REAL route via app.inject.
//
// Two process-wide caching layers now sit in front of this route's DB read:
// the route-level response cache (this file's subject, keyed per-user) and
// the lib-layer getRates() memo (spec-WI-072 §1, base-keyed only, tested in
// rates.test.ts). Both are cleared in beforeEach per their own documented
// warnings, so every test below starts cold.
const findUniqueMock = vi.fn();
const manualUpsertMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    exchangeRateCache: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
    // Only needed for the "manual rate write invalidates cache" test below —
    // POST /rates/manual must actually succeed (and reach bumpUserGeneration)
    // for that scenario to be meaningful.
    manualExchangeRate: {
      upsert: (...args: unknown[]) => manualUpsertMock(...args),
    },
  },
}));

// Spy on cached() (real implementation preserved via importOriginal, same
// technique already used elsewhere in this suite e.g. friends-route.test.ts)
// so we can assert the exact ttlMs the /rates route passes in, without
// sleeping in real time or relying on fake timers reaching into lru-cache's
// internal clock.
vi.mock('../src/lib/cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/cache')>();
  return { ...actual, cached: vi.fn(actual.cached) };
});

import { buildApp } from '../src/app';
import { cached, resetCacheForTests, bumpUserGeneration } from '../src/lib/cache';
import { resetRatesMemoForTests } from '../src/lib/rates';

const cachedSpy = cached as unknown as ReturnType<typeof vi.fn>;

/** A fresh (< 12h old) ExchangeRateCache row for `base`. */
function freshCacheRow(base: string, rates: Record<string, number>) {
  return { id: 'cache_1', base, rates, fetchedAt: new Date() };
}

let app: FastifyInstance;

beforeEach(async () => {
  findUniqueMock.mockReset();
  manualUpsertMock.mockReset();
  manualUpsertMock.mockResolvedValue({
    id: 'm1',
    userId: 'rates-manual-user',
    fromCurrency: 'USD',
    toCurrency: 'PKR',
    rate: 278.5,
    createdAt: new Date('2026-07-13T00:00:00.000Z'),
    updatedAt: new Date('2026-07-13T00:00:00.000Z'),
  });
  cachedSpy.mockClear();
  // Both process-wide caches are singletons across the whole test file (and
  // even across other files in the same worker) — clear both per lib/cache.ts's
  // and lib/rates.ts's own documented beforeEach warnings.
  resetCacheForTests();
  resetRatesMemoForTests();
  app = await buildApp();
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

function tokenFor(userId: string) {
  return app.jwt.sign({ sub: userId });
}

async function getRatesRoute(userId: string, base?: string) {
  const qs = base ? `?base=${base}` : '';
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/rates${qs}`,
    headers: { authorization: `Bearer ${tokenFor(userId)}` },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('GET /api/v1/rates — cached() wrap (spec-WI-072 §2)', () => {
  it('a repeat call with the same base for the same user is served from cache (underlying DB read fires only once)', async () => {
    findUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1, EUR: 0.9, GBP: 0.8 }));

    const first = await getRatesRoute('user_1', 'USD');
    const second = await getRatesRoute('user_1', 'USD');

    expect(second).toEqual(first);
    expect(findUniqueMock).toHaveBeenCalledTimes(1);
  });

  it('two distinct base values for the same user produce independent cache entries (no cross-base bleed)', async () => {
    findUniqueMock.mockImplementation((call: unknown) => {
      const base = (call as { where: { base: string } }).where.base;
      return Promise.resolve(
        base === 'USD'
          ? freshCacheRow('USD', { USD: 1, EUR: 0.9 })
          : freshCacheRow('EUR', { EUR: 1, USD: 1.11 }),
      );
    });

    const usd = await getRatesRoute('user_1', 'USD');
    const eur = await getRatesRoute('user_1', 'EUR');

    expect(usd.base).toBe('USD');
    expect(eur.base).toBe('EUR');
    expect(usd).not.toEqual(eur);
    // One DB read per distinct base — proves USD's cache entry was never
    // consulted for the EUR request.
    expect(findUniqueMock).toHaveBeenCalledTimes(2);
  });

  it('two distinct users requesting the same base get independent cache entries (mandatory cacheKey() userId component — documented behavior, not a bug)', async () => {
    findUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1, EUR: 0.9 }));

    const user1First = await getRatesRoute('rates-user-1', 'USD');
    const user2First = await getRatesRoute('rates-user-2', 'USD');

    // Same underlying data, so the response bodies happen to be equal —
    // that alone would not distinguish "two independent cache entries" from
    // "one shared entry". The lib-layer getRates() memo (§1) is base-keyed,
    // not user-keyed, so it legitimately serves both users from one shared
    // in-flight/resolved promise: exactly one DB read for both first calls.
    expect(user1First).toEqual(user2First);
    expect(findUniqueMock).toHaveBeenCalledTimes(1);

    // Now prove the ROUTE cache itself (not just the shared lib memo) really
    // holds two separate per-user entries: clear the lib-layer memo only
    // (leaving each user's own route-cache entry alone) and change what the
    // DB would return, then bump ONLY user 1's generation.
    resetRatesMemoForTests();
    findUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1, EUR: 0.5 }));
    bumpUserGeneration('rates-user-1');

    const user1Second = await getRatesRoute('rates-user-1', 'USD');
    expect(user1Second).not.toEqual(user1First); // user 1's entry was invalidated -> fresh read
    expect(user1Second.rates.EUR).toBe(0.5);

    const user2Second = await getRatesRoute('rates-user-2', 'USD');
    // user 2's own route-cache entry was never bumped -> still the STALE
    // first value, proving genuine per-user isolation (not an accident of
    // identical underlying data).
    expect(user2Second).toEqual(user2First);

    // Exactly one extra DB read (user 1's post-bump fresh call); user 2's
    // second call must be served entirely from its own untouched cache entry.
    expect(findUniqueMock).toHaveBeenCalledTimes(2);
  });

  it('a manual rate write still invalidates this user\'s /rates cache entry (over-invalidation-is-safe convention)', async () => {
    findUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1, EUR: 0.9 }));

    const first = await getRatesRoute('rates-manual-user', 'USD');

    resetRatesMemoForTests();
    findUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1, EUR: 0.5 }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rates/manual',
      headers: { authorization: `Bearer ${tokenFor('rates-manual-user')}` },
      payload: { from: 'USD', to: 'PKR', rate: 278.5 },
    });
    expect(res.statusCode).toBe(200);

    const second = await getRatesRoute('rates-manual-user', 'USD');
    expect(second).not.toEqual(first); // cache miss -> fresh read, even though the manual rate doesn't change /rates data
    expect(second.rates.EUR).toBe(0.5);
  });

  it('passes a bounded 60_000ms TTL to cached() — the route cache never stacks a longer-lived staleness allowance on top of the 12h DB-cache contract', async () => {
    findUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1, EUR: 0.9 }));

    await getRatesRoute('user_1', 'USD');

    const ratesCall = cachedSpy.mock.calls.find(([key]) => (key as string).startsWith('rates:'));
    expect(ratesCall).toBeDefined();
    expect(ratesCall![1]).toBe(60_000);
  });
});
