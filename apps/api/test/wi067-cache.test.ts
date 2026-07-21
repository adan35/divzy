import { describe, expect, it, vi } from 'vitest';

/**
 * spec-WI-067 §3 / §8 — `apps/api/src/lib/cache.ts` public surface: `cached`,
 * `userGeneration`, `bumpUserGeneration`, `bumpUsers`, `cacheKey`. Written
 * directly from the spec's exact interface + story-WI-067.md's Gherkin
 * (User Stories 1-4) before `lib/cache.ts` existed — red first: this whole
 * file fails to even import until the module is created.
 *
 * Module-level stores in `lib/cache.ts` are singletons shared by every test
 * in this file (one real `lru-cache` instance, not reset between tests), so
 * every test below uses its own uniquely-prefixed keys/userIds to stay
 * independent. The one exception is the eviction test, which is last on
 * purpose (it inserts 50,001 more entries into the shared generation store).
 */
import { bumpUserGeneration, bumpUsers, cached, cacheKey, userGeneration } from '../src/lib/cache';

describe('cached() — read-through hit/miss (Story 1)', () => {
  it('a second call with the same key inside the TTL returns the SAME value without re-invoking fn', async () => {
    const fn = vi.fn().mockResolvedValue({ v: 1, tag: 'hit-test' });
    const first = await cached('hit-test:key', 10_000, fn);
    const second = await cached('hit-test:key', 10_000, fn);

    expect(second).toBe(first); // byte-for-byte identical — same stored reference
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('two different keys never share an entry — each invokes fn', async () => {
    const fn = vi.fn().mockResolvedValue({ v: 2 });
    await cached('distinct-keys:a', 10_000, fn);
    await cached('distinct-keys:b', 10_000, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('expires by TTL and recomputes even with no bump (Story 4 safety net)', async () => {
    const fn = vi.fn().mockResolvedValue({ v: 3 });
    await cached('ttl-expiry:key', 30, fn);
    expect(fn).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 150));

    await cached('ttl-expiry:key', 30, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('never caches a rejection — a throwing fn is re-invoked next time, never serving a poisoned entry', async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return { ok: true };
    });

    await expect(cached('rejection:key', 10_000, fn)).rejects.toThrow('boom');
    const result = await cached('rejection:key', 10_000, fn);

    expect(result).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('cacheKey() + generation bump — invalidation (Story 2) and isolation (Story 3)', () => {
  it('a generation bump changes the key for that user, producing a cache miss on the very next read', async () => {
    const userId = 'gen-bump-user';
    const fn = vi.fn().mockResolvedValue({ v: 1 });

    const keyBefore = cacheKey('route', userId, {});
    await cached(keyBefore, 10_000, fn);
    await cached(cacheKey('route', userId, {}), 10_000, fn); // same generation => same key => hit
    expect(fn).toHaveBeenCalledTimes(1);

    bumpUserGeneration(userId);
    const keyAfter = cacheKey('route', userId, {});
    expect(keyAfter).not.toBe(keyBefore);

    await cached(keyAfter, 10_000, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('user isolation: two different userIds never resolve to the same key', () => {
    const keyA = cacheKey('balance', 'isolation-user-a', {});
    const keyB = cacheKey('balance', 'isolation-user-b', {});
    expect(keyA).not.toBe(keyB);
  });

  it('param isolation: two different validated param sets never resolve to the same key', () => {
    const noGroup = cacheKey('analytics/summary', 'param-user', { currency: 'USD' });
    const withGroup = cacheKey('analytics/summary', 'param-user', { currency: 'USD', groupId: 'g1' });
    const eurKey = cacheKey('analytics/summary', 'param-user', { currency: 'EUR' });
    expect(noGroup).not.toBe(withGroup);
    expect(noGroup).not.toBe(eurKey);
    expect(withGroup).not.toBe(eurKey);
  });

  it('canonicalizes object key order before hashing — key-order alone never splits the cache', () => {
    const a = cacheKey('route', 'canon-user', { currency: 'USD', groupId: 'g1', from: '2026-01-01' });
    const b = cacheKey('route', 'canon-user', { from: '2026-01-01', groupId: 'g1', currency: 'USD' });
    expect(a).toBe(b);
  });
});

describe('userGeneration / bumpUserGeneration / bumpUsers', () => {
  it('an unseen user starts at generation 0', () => {
    expect(userGeneration('never-seen-user')).toBe(0);
  });

  it('bumpUserGeneration increments exactly one user', () => {
    expect(userGeneration('single-bump-user')).toBe(0);
    bumpUserGeneration('single-bump-user');
    expect(userGeneration('single-bump-user')).toBe(1);
    bumpUserGeneration('single-bump-user');
    expect(userGeneration('single-bump-user')).toBe(2);
  });

  it('bumpUsers dedupes an iterable and bumps every distinct user exactly once', () => {
    bumpUsers(['dup-user-x', 'dup-user-y', 'dup-user-x', 'dup-user-x']);
    expect(userGeneration('dup-user-x')).toBe(1);
    expect(userGeneration('dup-user-y')).toBe(1);
  });

  it('bumpUsers on an empty iterable bumps nobody', () => {
    bumpUsers([]);
    expect(userGeneration('untouched-empty-bump-user')).toBe(0);
  });
});

describe('generation-map memory bound (spec §3.4 gap-closure)', () => {
  it('evicting the oldest of 50_001 distinct users resets their generation to 0, never colliding with a live entry', () => {
    for (let i = 0; i < 50_001; i += 1) {
      bumpUserGeneration(`evict-probe-user-${i}`);
    }
    // The very first inserted user is evicted once the 50_001st distinct key
    // lands (max: 50_000) — its generation resets to the unseen-user default.
    expect(userGeneration('evict-probe-user-0')).toBe(0);
    // The most recently inserted user is still resident.
    expect(userGeneration('evict-probe-user-50000')).toBe(1);
  });
});
