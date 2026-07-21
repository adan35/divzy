import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Independently authored functional/black-box tests for story-WI-002
// (analytics), derived from the Gherkin scenarios — not from reading
// rates.ts's implementation or copying rates-manual.test.ts's fixtures.
// Uses a different currency pair (BDT/EUR) than the build-stage dev's own
// tests (PKR/USD) throughout, and hand-computes expected minor-unit amounts
// rather than delegating to convert() to generate its own expectation.
//
// Direction note: FALLBACK_RATES is mocked below to omit BDT. Because
// resolveConversionRates(to, extras) resolves the live/fallback map keyed on
// `to` (the base), the omitted currency must always be the `from` side here
// (BDT) — omitting the `to`/base side would make fallbackRatesFor() itself
// throw UNSUPPORTED_CURRENCY (missing base rate) instead of the intended
// RATE_UNAVAILABLE-for-one-side-of-the-pair condition these scenarios test.
//
// Test-plan: .company/domains/analytics/test-plans/test-plan-WI-002.md
// Case IDs TC-WI002-01..08 map 1:1 to the scenarios below.

const findUniqueMock = vi.fn();
const manualFindUniqueMock = vi.fn();
const manualUpsertMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    exchangeRateCache: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      upsert: vi.fn(),
    },
    manualExchangeRate: {
      findUnique: (...args: unknown[]) => manualFindUniqueMock(...args),
      upsert: (...args: unknown[]) => manualUpsertMock(...args),
    },
  },
}));

// Forces the automatic chain to be exhaustible for BDT, the same technique
// the build-stage dev used for PKR — see rates-unavailable.test.ts.
vi.mock('../src/lib/rates-fallback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/rates-fallback')>();
  const { BDT: _omitted, ...rest } = actual.FALLBACK_RATES;
  return { FALLBACK_RATES: rest };
});

import type { FastifyInstance } from 'fastify';
import { convertAmountForUser, resetRatesMemoForTests } from '../src/lib/rates';
import { buildApp } from '../src/app';

function freshCacheRow(base: string, rates: Record<string, number>) {
  return { id: 'cache_1', base, rates, fetchedAt: new Date() };
}

beforeEach(() => {
  findUniqueMock.mockReset();
  manualFindUniqueMock.mockReset();
  manualUpsertMock.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
  // WI-072 §1's getRates() memo persists across it() blocks in this file
  // (base 'EUR' re-mocked per test) unless cleared each time.
  resetRatesMemoForTests();
});

// TC-WI002-01 — "Missing rate is detected and the user is prompted"
describe('TC-WI002-01: RATE_UNAVAILABLE is detected, not swallowed', () => {
  it('rejects rather than silently failing or returning an unconverted amount when nothing is on file', async () => {
    findUniqueMock.mockResolvedValue(null);
    manualFindUniqueMock.mockResolvedValue(null);

    let returnedNormally = false;
    try {
      await convertAmountForUser('user_1', 1000, 'BDT', 'EUR');
      returnedNormally = true;
    } catch {
      // expected
    }
    expect(returnedNormally).toBe(false);
    await expect(convertAmountForUser('user_1', 1000, 'BDT', 'EUR')).rejects.toMatchObject({
      statusCode: 500,
      code: 'RATE_UNAVAILABLE',
    });
  });
});

// TC-WI002-02 — "Manual rate is persisted and used for the conversion that
// triggered it"
describe('TC-WI002-02: a stored manual rate is applied with the exponent-shift + single-round rule', () => {
  it('computes the conversion via the synthetic {from:1, to:rate} map correctly', async () => {
    findUniqueMock.mockResolvedValue(null); // automatic chain exhausted for BDT->EUR
    manualFindUniqueMock.mockResolvedValue({
      id: 'manual_1',
      userId: 'user_1',
      fromCurrency: 'BDT',
      toCurrency: 'EUR',
      rate: 0.00785, // 1 BDT = 0.00785 EUR
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await convertAmountForUser('user_1', 254900, 'BDT', 'EUR'); // 2549.00 BDT

    // Hand-computed independent of convert(): both BDT and EUR are 2-decimal
    // currencies, so exponentShift = 1. 2549.00 * 0.00785 = 20.009649... EUR
    // -> 2000.9649 minor -> round 2001 (not truncated to 2000).
    const expected = Math.round(254900 * 0.00785);
    expect(expected).toBe(2001);
    expect(result.amount).toBe(2001);
    expect(result.source).toBe('manual');
  });
});

// TC-WI002-03 — "User is prompted exactly once per pair, not repeatedly"
describe('TC-WI002-03: a persisted manual rate is reused automatically, never re-persisted by convertAmountForUser', () => {
  it('resolves the same pair twice via the stored row without ever writing to the manual table itself', async () => {
    findUniqueMock.mockResolvedValue(null);
    manualFindUniqueMock.mockResolvedValue({
      id: 'manual_1',
      userId: 'user_1',
      fromCurrency: 'BDT',
      toCurrency: 'EUR',
      rate: 0.00785,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const first = await convertAmountForUser('user_1', 1000, 'BDT', 'EUR');
    const second = await convertAmountForUser('user_1', 1000, 'BDT', 'EUR');

    expect(first.source).toBe('manual');
    expect(second.source).toBe('manual');
    expect(manualFindUniqueMock).toHaveBeenCalledTimes(2); // one lookup per conversion
    // convertAmountForUser is read-only w.r.t. the manual table — persistence
    // is exclusively POST /rates/manual's job, never a side effect of a
    // conversion call. This is what makes "not re-prompted" possible at the
    // consuming (settlements/social-groups) layer.
    expect(manualUpsertMock).not.toHaveBeenCalled();
  });
});

// TC-WI002-04 — "A second, different missing pair prompts independently"
describe('TC-WI002-04: independent per-pair resolution', () => {
  it('resolving BDT->EUR does not affect or short-circuit an unresolved BDT->GBP for the same user', async () => {
    findUniqueMock.mockResolvedValue(null);
    manualFindUniqueMock.mockImplementation(
      ({ where }: { where: { userId_fromCurrency_toCurrency: { fromCurrency: string; toCurrency: string } } }) => {
        const { fromCurrency, toCurrency } = where.userId_fromCurrency_toCurrency;
        if (fromCurrency === 'BDT' && toCurrency === 'EUR') {
          return Promise.resolve({
            id: 'manual_1',
            userId: 'user_1',
            fromCurrency: 'BDT',
            toCurrency: 'EUR',
            rate: 0.00785,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
        return Promise.resolve(null);
      },
    );

    const resolved = await convertAmountForUser('user_1', 1000, 'BDT', 'EUR');
    expect(resolved.source).toBe('manual');

    await expect(convertAmountForUser('user_1', 1000, 'BDT', 'GBP')).rejects.toMatchObject({
      code: 'RATE_UNAVAILABLE',
    });

    expect(manualFindUniqueMock).toHaveBeenCalledWith({
      where: { userId_fromCurrency_toCurrency: { userId: 'user_1', fromCurrency: 'BDT', toCurrency: 'EUR' } },
    });
    expect(manualFindUniqueMock).toHaveBeenCalledWith({
      where: { userId_fromCurrency_toCurrency: { userId: 'user_1', fromCurrency: 'BDT', toCurrency: 'GBP' } },
    });
  });
});

// TC-WI002-05 — "Manual rate is user-scoped, not shared automatically
// across users"
describe('TC-WI002-05: per-user scoping', () => {
  it('does not resolve user Bs missing pair using user As stored manual rate', async () => {
    findUniqueMock.mockResolvedValue(null);
    manualFindUniqueMock.mockImplementation(
      ({ where }: { where: { userId_fromCurrency_toCurrency: { userId: string } } }) => {
        if (where.userId_fromCurrency_toCurrency.userId === 'user_A') {
          return Promise.resolve({
            id: 'manual_1',
            userId: 'user_A',
            fromCurrency: 'BDT',
            toCurrency: 'EUR',
            rate: 0.00785,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
        return Promise.resolve(null);
      },
    );

    const userAResult = await convertAmountForUser('user_A', 1000, 'BDT', 'EUR');
    expect(userAResult.source).toBe('manual');

    await expect(convertAmountForUser('user_B', 1000, 'BDT', 'EUR')).rejects.toMatchObject({
      code: 'RATE_UNAVAILABLE',
    });
    expect(manualFindUniqueMock).toHaveBeenCalledWith({
      where: { userId_fromCurrency_toCurrency: { userId: 'user_B', fromCurrency: 'BDT', toCurrency: 'EUR' } },
    });
  });
});

// TC-WI002-06 — "Automatic rate later becomes available for a pair with a
// stored manual rate" (ADR-006 precedence policy)
describe('TC-WI002-06: automatic rate takes precedence deterministically once available', () => {
  it('never consults the manual table when the automatic chain resolves', async () => {
    findUniqueMock.mockResolvedValue(freshCacheRow('EUR', { EUR: 1, BDT: 128.2 })); // automatic now resolvable via live cache
    manualFindUniqueMock.mockResolvedValue({
      id: 'manual_1',
      userId: 'user_1',
      fromCurrency: 'BDT',
      toCurrency: 'EUR',
      rate: 999999, // deliberately absurd — must never be used while automatic works
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await convertAmountForUser('user_1', 1000, 'BDT', 'EUR');

    expect(result.source).toBe('live');
    expect(manualFindUniqueMock).not.toHaveBeenCalled();
    // Sanity: the automatic result is nowhere near the absurd manual rate,
    // proving the manual row genuinely wasn't applied.
    expect(result.amount).toBeLessThan(1_000_000);
  });
});

// TC-WI002-07 — "User declines or abandons the manual-rate prompt"
describe('TC-WI002-07: declining leaves the pair unresolved, not silently converted, and re-eligible', () => {
  it('keeps rejecting with RATE_UNAVAILABLE across repeated attempts when nothing was ever persisted', async () => {
    findUniqueMock.mockResolvedValue(null);
    manualFindUniqueMock.mockResolvedValue(null); // nothing persisted (decline/abandon)

    await expect(convertAmountForUser('user_1', 1000, 'BDT', 'EUR')).rejects.toMatchObject({
      code: 'RATE_UNAVAILABLE',
    });
    // A later occasion (e.g. the balance is viewed again) is not treated as
    // "already prompted" — it must be eligible to fail (and re-prompt) again,
    // not silently succeed with a fabricated rate the second time.
    await expect(convertAmountForUser('user_1', 1000, 'BDT', 'EUR')).rejects.toMatchObject({
      code: 'RATE_UNAVAILABLE',
    });
    expect(manualUpsertMock).not.toHaveBeenCalled();
  });
});

// TC-WI002-08 — "Manual rate input validation" (POST /rates/manual, black-box
// via app.inject, a different pair/values than the build-stage dev's tests)
describe('TC-WI002-08: POST /rates/manual input validation', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    app = await buildApp();
    await app.ready();
    token = app.jwt.sign({ sub: 'user_1' });
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects a non-numeric rate string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rates/manual',
      headers: { authorization: `Bearer ${token}` },
      payload: { from: 'EUR', to: 'JPY', rate: 'not-a-number' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(manualUpsertMock).not.toHaveBeenCalled();
  });

  it('rejects a zero rate', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rates/manual',
      headers: { authorization: `Bearer ${token}` },
      payload: { from: 'EUR', to: 'JPY', rate: 0 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(manualUpsertMock).not.toHaveBeenCalled();
  });

  it('rejects a negative rate', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rates/manual',
      headers: { authorization: `Bearer ${token}` },
      payload: { from: 'EUR', to: 'JPY', rate: -3.5 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(manualUpsertMock).not.toHaveBeenCalled();
  });

  it('accepts a small-but-positive rate at the boundary (not treated as invalid)', async () => {
    manualUpsertMock.mockResolvedValue({
      id: 'm2',
      userId: 'user_1',
      fromCurrency: 'EUR',
      toCurrency: 'JPY',
      rate: 0.0001,
      createdAt: new Date('2026-07-14T00:00:00.000Z'),
      updatedAt: new Date('2026-07-14T00:00:00.000Z'),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rates/manual',
      headers: { authorization: `Bearer ${token}` },
      payload: { from: 'EUR', to: 'JPY', rate: 0.0001 },
    });
    expect(res.statusCode).toBe(200);
    expect(manualUpsertMock).toHaveBeenCalledTimes(1);
  });
});
