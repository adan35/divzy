import { beforeEach, describe, expect, it, vi } from 'vitest';

// TC-WI001-05 — story-WI-001 "Rate cannot be resolved for a required pair".
// Independently authored (uses LKR, not PKR, to avoid duplicating the
// build-stage dev's own rates-unavailable.test.ts fixture) — see
// test-plan-WI-001.md.

const findUniqueMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    exchangeRateCache: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      upsert: vi.fn(),
    },
  },
}));

// Simulates drift between the 52 (per the story's wording) supported
// currencies and the bundled fallback table — the only way a nominally
// supported code becomes genuinely unresolvable end-to-end once fresh
// cache, live fetch, and stale cache have all also missed.
vi.mock('../src/lib/rates-fallback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/rates-fallback')>();
  const { LKR: _omitted, ...rest } = actual.FALLBACK_RATES;
  return { FALLBACK_RATES: rest };
});

import { convertAmount } from '../src/lib/rates';

beforeEach(() => {
  findUniqueMock.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
});

describe('TC-WI001-05: convertAmount raises RATE_UNAVAILABLE, never a silent zero/null', () => {
  it('rejects with AppError(500, RATE_UNAVAILABLE) when no stage of the chain can resolve one side of the pair', async () => {
    findUniqueMock.mockResolvedValue(null); // no fresh/stale cache; live fetch fails; fallback lacks LKR

    let caught: unknown;
    let returnedNormally = false;
    try {
      await convertAmount(1000, 'LKR', 'USD');
      returnedNormally = true;
    } catch (err) {
      caught = err;
    }

    // Explicitly assert it did NOT resolve to some falsy/zero/unconverted value.
    expect(returnedNormally).toBe(false);
    expect(caught).toMatchObject({ statusCode: 500, code: 'RATE_UNAVAILABLE' });
  });
});
