import { beforeEach, describe, expect, it, vi } from 'vitest';

// Independently authored functional/black-box tests for story-WI-001
// (analytics), written from the Gherkin scenarios themselves — NOT from
// reading rates.ts's implementation or copying rates.test.ts's expected
// values. Expected numbers below are hand-computed with the documented
// contract ("cross-rate via the base currency's rate map, exponent-shifted
// for differing decimal places, exactly one Math.round at the end") rather
// than by calling convert()/convertAmount() to generate their own
// expectation, so a bug in convert()'s implementation cannot silently
// launder itself into a passing assertion.
//
// Test-plan: .company/domains/analytics/test-plans/test-plan-WI-001.md
// Case IDs TC-WI001-01..07 map 1:1 to the scenarios below.

const findUniqueMock = vi.fn();
const upsertMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    exchangeRateCache: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      upsert: (...args: unknown[]) => upsertMock(...args),
    },
  },
}));

import { FALLBACK_RATES } from '../src/lib/rates-fallback';
import { convertAmount, resolveConversionRates } from '../src/lib/rates';

function freshCacheRow(base: string, rates: Record<string, number>) {
  return { id: 'cache_1', base, rates, fetchedAt: new Date() };
}

beforeEach(() => {
  findUniqueMock.mockReset();
  upsertMock.mockReset();
  vi.unstubAllGlobals();
});

// TC-WI001-01 — "Another domain obtains a converted amount for a supported pair"
describe('TC-WI001-01: convertAmount computes a supported-pair conversion correctly', () => {
  it('converts EUR minor units to USD via the documented cross-rate formula', async () => {
    // rates map is keyed on base=USD (the `to` currency), per getRates' contract.
    findUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1, EUR: 0.92 }));

    const result = await convertAmount(10050, 'EUR', 'USD'); // 100.50 EUR

    // Hand-computed, independent of convert(): 100.50 / 0.92 = 109.2391...
    const expected = Math.round(10050 * (1 / 0.92));
    expect(expected).toBe(10924);
    expect(result.amount).toBe(10924);
    expect(result.source).toBe('live');
  });
});

// TC-WI001-02 — "Conversion source is live/cached rates, never a stale
// hand-rolled table" — fallback disclosure for pair (GBP, PKR).
describe('TC-WI001-02: fallback-derived amounts are disclosed via source: fallback', () => {
  it('reports source: fallback and computes via the real bundled table when live+cache both miss', async () => {
    findUniqueMock.mockResolvedValue(null); // no cache row at all
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const result = await convertAmount(5000, 'GBP', 'PKR'); // 50.00 GBP

    expect(result.source).toBe('fallback');
    // Hand-computed from the real bundled table (not mocked here — this
    // asserts against production fallback data, not a test double):
    // fallbackRatesFor('PKR')[GBP] = FALLBACK_RATES.GBP / FALLBACK_RATES.PKR
    const gbpPerPkr = FALLBACK_RATES.GBP / FALLBACK_RATES.PKR;
    const expected = Math.round(5000 * (1 / gbpPerPkr));
    expect(result.amount).toBe(expected);
  });
});

// TC-WI001-03 — "Same-currency pair short-circuits without precision loss"
describe('TC-WI001-03: same-currency short-circuit', () => {
  it('returns the original amount unchanged with zero rate lookups, case-insensitively', async () => {
    const result = await convertAmount(12345, 'usd', 'USD');

    expect(result).toEqual({ amount: 12345, source: 'live' });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});

// TC-WI001-04 — "Precision is preserved across differing minor-unit currencies"
describe('TC-WI001-04: cross-decimal-exponent precision (0-decimal and 3-decimal targets)', () => {
  it('converts USD (2dp) to JPY (0dp) without truncating a fractional yen-equivalent', async () => {
    // 1 JPY = 1/150 USD exactly, by construction, so the expected value is exact.
    findUniqueMock.mockResolvedValue(freshCacheRow('JPY', { JPY: 1, USD: 1 / 150 }));

    const result = await convertAmount(1051, 'USD', 'JPY'); // 10.51 USD

    // 10.51 USD * 150 JPY/USD = 1576.5 JPY -> must round, not truncate, to 1577.
    const expected = Math.round(1051 * 150 * 10 ** (0 - 2));
    expect(expected).toBe(1577);
    expect(result.amount).toBe(1577);
  });

  it('converts USD (2dp) to KWD (3dp) preserving the third decimal place', async () => {
    // 1 USD = 0.31 KWD exactly, by construction.
    findUniqueMock.mockResolvedValue(freshCacheRow('KWD', { KWD: 1, USD: 1 / 0.31 }));

    const result = await convertAmount(999, 'USD', 'KWD'); // 9.99 USD

    // 9.99 USD * 0.31 KWD/USD = 3.0969 KWD -> 3097 minor units (3 decimals), not 310/3096.
    const expected = Math.round(999 * 0.31 * 10 ** (3 - 2));
    expect(expected).toBe(3097);
    expect(result.amount).toBe(3097);
  });
});

// TC-WI001-05 — "Rate cannot be resolved for a required pair" — see the
// dedicated wi001-blackbox-rate-unavailable-independent.test.ts (a separate
// file, matching this codebase's existing convention for
// rates-fallback-module mocking, e.g. rates-unavailable.test.ts) since it
// needs a different module-mock setup than the rest of this file.

// TC-WI001-06 — "Unsupported currency code requested"
describe('TC-WI001-06: unsupported currency code guard', () => {
  it('rejects with 400 UNSUPPORTED_CURRENCY on either side before any rate lookup', async () => {
    await expect(convertAmount(1000, 'ZZZ', 'USD')).rejects.toMatchObject({
      statusCode: 400,
      code: 'UNSUPPORTED_CURRENCY',
    });
    await expect(convertAmount(1000, 'USD', 'ZZZ')).rejects.toMatchObject({
      statusCode: 400,
      code: 'UNSUPPORTED_CURRENCY',
    });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});

// TC-WI001-07 — "High call volume from balance list surfaces does not
// multiply live fetches"
describe('TC-WI001-07: repeated conversions in one page render reuse the 12h cache', () => {
  it('never calls the live fetch when many sequential resolveConversionRates calls share a fresh cache row', async () => {
    findUniqueMock.mockResolvedValue(freshCacheRow('EUR', { EUR: 1, USD: 0.92, GBP: 0.8, JPY: 0.0066 }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // Simulates a dashboard/friends/groups page converting many balances
    // (several sharing currencies) to the same target in one render.
    await resolveConversionRates('EUR', ['USD', 'GBP']);
    await resolveConversionRates('EUR', ['JPY', 'USD']);
    await resolveConversionRates('EUR', ['GBP', 'GBP', 'GBP']);
    await resolveConversionRates('EUR', []);
    await resolveConversionRates('EUR', ['USD', 'JPY', 'GBP']);

    expect(fetchMock).not.toHaveBeenCalled();
    // WI-072: getRates()'s in-process memo coalesces same-base calls within its
    // TTL window into one DB read — the scenario's real contract (no network
    // fetch) is unaffected.
    expect(findUniqueMock).toHaveBeenCalledTimes(1);
  });
});
