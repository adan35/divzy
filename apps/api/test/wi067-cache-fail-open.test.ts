import { describe, expect, it, vi } from 'vitest';

/**
 * spec-WI-067 §3.4 / ADR-030 sign-off condition C1 (non-negotiable): "a cache
 * error must never turn a read into a 500." This is proven in isolation by
 * mocking `lru-cache` itself so every `get`/`set`/`has` call throws, then
 * asserting `cached()` still resolves to the correct value by falling
 * through to `fn()`. This file mocks the WHOLE `lru-cache` module, so it is
 * kept separate from wi067-cache.test.ts (which needs the real store).
 */
vi.mock('lru-cache', () => {
  class ThrowingLRUCache {
    get(): never {
      throw new Error('cache backend unavailable');
    }
    set(): never {
      throw new Error('cache backend unavailable');
    }
    has(): never {
      throw new Error('cache backend unavailable');
    }
  }
  return { LRUCache: ThrowingLRUCache };
});

describe('cached() — fail-open (Story 1, ADR-030 C1)', () => {
  it('a throwing store never fails the read: fn still runs and its value is returned', async () => {
    const { cached } = await import('../src/lib/cache');
    const fn = vi.fn().mockResolvedValue({ ok: true, computed: 42 });

    await expect(cached('fail-open:key', 10_000, fn)).resolves.toEqual({ ok: true, computed: 42 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a throwing store never surfaces an error even when fn is called repeatedly (no caching possible)', async () => {
    const { cached } = await import('../src/lib/cache');
    const fn = vi.fn().mockResolvedValue({ ok: true });

    await cached('fail-open:key-2', 10_000, fn);
    await cached('fail-open:key-2', 10_000, fn);

    // Store is entirely broken, so every call must fall through to fn — this
    // is the direct proof that a broken cache degrades to "always recompute",
    // never to a 500 or a stuck error.
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
