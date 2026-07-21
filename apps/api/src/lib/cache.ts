import { LRUCache } from 'lru-cache';

/**
 * WI-067 / ADR-030 — in-memory LRU response cache + per-user generation
 * invalidation. Exact public surface per spec-WI-067.md §3. Single process
 * only (ADR-001 deployment); the multi-instance staleness ceiling is the
 * documented, accepted limitation in ADR-030.
 */

// ---------------------------------------------------------------------------
// Response store (spec §3.3): bounded to ~5k entries; per-entry TTL is passed
// on `set` so every wrapped route can share one store with its own ceiling
// (60s /analytics/summary, 15s /balance).
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- lru-cache's
// value generic is constrained to `{}` (excludes null/undefined), which
// `unknown` cannot satisfy; `cached<T>` casts on the way in/out instead.
const responseStore = new LRUCache<string, any>({ max: 5_000 });

/**
 * Read-through cache. Returns the cached value if present & unexpired, else
 * awaits `fn()`, stores the RESOLVED value under `key` with `ttlMs`, and
 * returns it.
 *
 * Fail-open (spec §3.4 — mandatory): ANY error thrown by the underlying LRU
 * `get`/`set` is swallowed and the call falls through to `fn()` — a
 * cache-layer failure must never turn a read into a 500. Only a *resolved*
 * `fn()` value is ever stored; if `fn()` rejects, the error propagates
 * unchanged and nothing is written under `key` (never cache a rejection).
 */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  try {
    const hit = responseStore.get(key);
    if (hit !== undefined) return hit as T;
  } catch {
    // Fail-open: a broken cache read degrades to a miss, never a thrown error.
  }

  const value = await fn();

  try {
    responseStore.set(key, value, { ttl: ttlMs });
  } catch {
    // Fail-open: a broken cache write never fails the read that produced `value`.
  }

  return value;
}

// ---------------------------------------------------------------------------
// Per-user generation counter (spec §3.1, §3.4 gap-closure).
//
// Bounded LRU, no TTL, max 50_000 distinct users. This retention horizon
// must stay strictly greater than the longest response-cache TTL (60s): an
// evicted user's generation resets to 0, and that reset is only safe because,
// by the time a user could be evicted from a 50k-entry map, every response
// entry keyed under their pre-eviction generation has already expired on its
// own (<= 60s). Do not shrink `max` or add a TTL here without re-checking
// that gen-map-horizon-greater-than-max-response-TTL invariant.
// ---------------------------------------------------------------------------
const generationStore = new LRUCache<string, number>({ max: 50_000 });

/** Unseen user => 0. */
export function userGeneration(userId: string): number {
  return generationStore.get(userId) ?? 0;
}

/** Increments one user's generation — every prior cache key for them becomes unreachable. */
export function bumpUserGeneration(userId: string): void {
  generationStore.set(userId, userGeneration(userId) + 1);
}

/** Dedupes `userIds` and bumps each distinct user exactly once. */
export function bumpUsers(userIds: Iterable<string>): void {
  for (const userId of new Set(userIds)) {
    bumpUserGeneration(userId);
  }
}

// ---------------------------------------------------------------------------
// Per-group generation counter (WI-071 / ADR-031 §1) — verbatim mirror of the
// per-user counter above. Bounded LRU, no TTL, max 50_000 distinct groups.
//
// Only route keying on `groupGeneration` is group-balances at 15s TTL — far
// shorter than the per-user map's 60s horizon — so the 50k bound is if
// anything more conservative here than for the user map. Do not shrink `max`
// or add a TTL without re-checking that eviction-horizon invariant (ADR-031 §1).
// ---------------------------------------------------------------------------
const groupGenerationStore = new LRUCache<string, number>({ max: 50_000 });

/** Unseen group => 0. */
export function groupGeneration(groupId: string): number {
  return groupGenerationStore.get(groupId) ?? 0;
}

/** Increments one group's generation — every prior group-scoped cache key becomes unreachable. */
export function bumpGroupGeneration(groupId: string): void {
  groupGenerationStore.set(groupId, groupGeneration(groupId) + 1);
}

// ---------------------------------------------------------------------------
// Cache key builder (spec §3.2).
// ---------------------------------------------------------------------------

/** Recursively sorts object keys (arrays keep their order) so two objects
 * that differ only in key insertion order hash identically. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      sorted[key] = canonicalize(input[key]);
    }
    return sorted;
  }
  return value;
}

/** Deterministic FNV-1a hash (hex) of canonical JSON. Not a security
 * boundary — just a compact, stable discriminator between param sets; the
 * only thing that isolates users from each other is `userId` in `cacheKey`. */
function hashParams(params: unknown): string {
  const json = JSON.stringify(canonicalize(params));
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/**
 * `${route}:${userId}:${userGeneration(userId)}:${paramsHash}`. `userId` is
 * the only thing that isolates one user's cache from another's — it is
 * mandatory here (Story 3). `params` must already be the validated,
 * normalized value (e.g. an upper-cased currency) so two requests the
 * handler treats as equivalent never split the cache into two entries.
 */
export function cacheKey(route: string, userId: string, params: unknown): string {
  return `${route}:${userId}:${userGeneration(userId)}:${hashParams(params)}`;
}

// ---------------------------------------------------------------------------
// Test-only support (NOT part of the spec §3.1 public interface).
//
// `responseStore`/`generationStore` are process-wide singletons by design
// (ADR-030 — one shared cache per process). That is correct for production,
// but it means any test file that mocks prisma with a FIXED userId and calls
// a wrapped route (`GET /balance`, `GET /analytics/summary`) more than once
// with different mock data across `it()` blocks will now observe a stale hit
// from an earlier test in the same file, unless it clears this state first.
// Call this in a `beforeEach` to make each test start from a cold cache —
// see the WI-067 build summary's "Notes for Test stage" for the concrete
// pre-existing files this was needed for.
// ---------------------------------------------------------------------------
export function resetCacheForTests(): void {
  responseStore.clear();
  generationStore.clear();
  groupGenerationStore.clear();
}
