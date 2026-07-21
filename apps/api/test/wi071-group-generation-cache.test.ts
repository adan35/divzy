// spec-WI-071.md §1.4 / ADR-031 — `apps/api/src/lib/cache.ts`'s new
// `groupGeneration`/`bumpGroupGeneration`/`groupGenerationStore` public
// surface, a verbatim mirror of WI-067's `userGeneration`/`bumpUserGeneration`
// (see wi067-cache.test.ts for the sibling suite this deliberately parallels).
//
// Module-level stores in `lib/cache.ts` are singletons shared by every test in
// this file (and by every other test file importing the same module in the
// same worker), so every test here uses its own uniquely-prefixed
// keys/groupIds to stay independent — same convention as wi067-cache.test.ts.
import { describe, expect, it, vi } from 'vitest';

import {
  bumpGroupGeneration,
  cached,
  cacheKey,
  groupGeneration,
  resetCacheForTests,
} from '../src/lib/cache';

describe('groupGeneration / bumpGroupGeneration', () => {
  it('an unseen group starts at generation 0', () => {
    expect(groupGeneration('never-seen-group-01')).toBe(0);
  });

  it('bumpGroupGeneration increments exactly one group', () => {
    expect(groupGeneration('single-bump-group-01')).toBe(0);
    bumpGroupGeneration('single-bump-group-01');
    expect(groupGeneration('single-bump-group-01')).toBe(1);
    bumpGroupGeneration('single-bump-group-01');
    expect(groupGeneration('single-bump-group-01')).toBe(2);
  });

  it('bumping one group never advances a different group (isolation)', () => {
    expect(groupGeneration('isolated-group-a-01')).toBe(0);
    expect(groupGeneration('isolated-group-b-01')).toBe(0);

    bumpGroupGeneration('isolated-group-a-01');

    expect(groupGeneration('isolated-group-a-01')).toBe(1);
    expect(groupGeneration('isolated-group-b-01')).toBe(0);
  });
});

describe('group-balances cache key folds in ggen — a bump changes the key, producing a miss', () => {
  it('cacheKey("group-balances", userId, {groupId, ggen}) changes after bumpGroupGeneration, invalidating a cached read', async () => {
    const userId = 'ggen-cache-user-01';
    const groupId = 'ggen-cache-group-01';
    const fn = vi.fn().mockResolvedValue({ v: 1 });

    const keyBefore = cacheKey('group-balances', userId, { groupId, ggen: groupGeneration(groupId) });
    await cached(keyBefore, 10_000, fn);
    // Same generation, same params -> same key -> hit, fn not re-invoked.
    await cached(cacheKey('group-balances', userId, { groupId, ggen: groupGeneration(groupId) }), 10_000, fn);
    expect(fn).toHaveBeenCalledTimes(1);

    bumpGroupGeneration(groupId);
    const keyAfter = cacheKey('group-balances', userId, { groupId, ggen: groupGeneration(groupId) });
    expect(keyAfter).not.toBe(keyBefore);

    await cached(keyAfter, 10_000, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('bumping group A never changes group B\'s key for the same viewer (no cross-group over-invalidation)', () => {
    const userId = 'ggen-cross-user-01';
    const groupA = 'ggen-cross-group-a-01';
    const groupB = 'ggen-cross-group-b-01';

    const keyBBefore = cacheKey('group-balances', userId, { groupId: groupB, ggen: groupGeneration(groupB) });
    bumpGroupGeneration(groupA);
    const keyBAfter = cacheKey('group-balances', userId, { groupId: groupB, ggen: groupGeneration(groupB) });

    expect(keyBAfter).toBe(keyBBefore); // group B's own component never moved
  });

  it('TTL is a safety net for group-scoped keys too — expires and recomputes even with no bump', async () => {
    const userId = 'ggen-ttl-user-01';
    const groupId = 'ggen-ttl-group-01';
    const fn = vi.fn().mockResolvedValue({ v: 3 });
    const key = cacheKey('group-balances', userId, { groupId, ggen: groupGeneration(groupId) });

    await cached(key, 30, fn);
    expect(fn).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 150));

    // Same key (no bump happened) but the entry itself has expired.
    await cached(key, 30, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('resetCacheForTests() also clears the group-generation store', () => {
  it('a bumped group generation resets to 0 after resetCacheForTests()', () => {
    const groupId = 'ggen-reset-group-01';
    bumpGroupGeneration(groupId);
    expect(groupGeneration(groupId)).toBe(1);

    resetCacheForTests();

    expect(groupGeneration(groupId)).toBe(0);
  });
});

describe('group-generation-map memory bound (mirrors the per-user map\'s eviction test)', () => {
  it('evicting the oldest of 50_001 distinct groups resets their generation to 0, never colliding with a live entry', () => {
    for (let i = 0; i < 50_001; i += 1) {
      bumpGroupGeneration(`evict-probe-group-${i}`);
    }
    expect(groupGeneration('evict-probe-group-0')).toBe(0);
    expect(groupGeneration('evict-probe-group-50000')).toBe(1);
  });
});
