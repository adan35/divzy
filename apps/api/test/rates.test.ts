import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { AppError } from '../src/lib/errors';
import {
  convert,
  convertAmount,
  getRates,
  resolveConversionRates,
  resetRatesMemoForTests,
} from '../src/lib/rates';

/** A fresh (< 12h old) ExchangeRateCache row for `base`. */
function freshCacheRow(base: string, rates: Record<string, number>) {
  return { id: 'cache_1', base, rates, fetchedAt: new Date() };
}

beforeEach(() => {
  findUniqueMock.mockReset();
  upsertMock.mockReset();
  vi.unstubAllGlobals();
  // WI-072 §1 added a 60s in-process memo in front of getRates()'s DB read;
  // this suite re-mocks findUnique per test for the same base, so the memo
  // must be cleared each test or a later test observes a stale memoized
  // result instead of its own mock (see resetRatesMemoForTests' doc comment).
  resetRatesMemoForTests();
});

// story-WI-001 (analytics) scenarios ------------------------------------------------

describe('resolveConversionRates', () => {
  it('resolves the target currency once and reuses it for every extra currency requested (High call volume ... does not multiply live fetches)', async () => {
    findUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1, EUR: 0.9, GBP: 0.8, PKR: 278 }));

    const result = await resolveConversionRates('USD', ['EUR', 'GBP', 'PKR', 'EUR']);

    expect(findUniqueMock).toHaveBeenCalledTimes(1);
    expect(result.rates).toMatchObject({ USD: 1, EUR: 0.9, GBP: 0.8, PKR: 278 });
    expect(result.usedFallbackRates).toBe(false);
  });

  it('seeds the target currency at 1 when the resolved map omits it', async () => {
    findUniqueMock.mockResolvedValue(freshCacheRow('USD', { EUR: 0.9 }));

    const result = await resolveConversionRates('USD');

    expect(result.rates.USD).toBe(1);
  });

  it('patches a missing extra currency from the bundled fallback table and flags usedFallbackRates (Conversion source is live/cached rates ...)', async () => {
    findUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1, EUR: 0.9 })); // no PKR live

    const result = await resolveConversionRates('USD', ['PKR']);

    expect(result.rates.PKR).toBeGreaterThan(0);
    expect(result.usedFallbackRates).toBe(true);
  });

  it('flags usedFallbackRates when the base resolution itself fell back to the bundled table', async () => {
    findUniqueMock.mockResolvedValue(null); // no cache row
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const result = await resolveConversionRates('USD', ['EUR']);

    expect(result.usedFallbackRates).toBe(true);
    expect(result.rates.EUR).toBeGreaterThan(0);
  });

  it('never issues more than one live rate lookup per call regardless of extraCurrencies count', async () => {
    findUniqueMock.mockResolvedValue(null);
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    await resolveConversionRates('USD', ['EUR', 'GBP', 'JPY', 'PKR', 'INR']);

    expect(findUniqueMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// WI-079 / ADR-033 Decision 3 (canonical contract, drb-architecture R1) ------
// One additive field: fallbackCurrencies — UPPERCASED codes of every requested
// currency whose resolved rate came from the bundled fallback table; viewer's
// own currency excluded; empty when everything resolved live.

describe('resolveConversionRates — fallbackCurrencies (WI-079, ADR-033 Decision 3)', () => {
  it('lists only the currencies patched from the fallback table when the base resolves live', async () => {
    findUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1, EUR: 0.9, GBP: 0.8 })); // PKR missing live

    const result = await resolveConversionRates('USD', ['EUR', 'PKR', 'GBP']);

    expect(result.fallbackCurrencies).toEqual(['PKR']);
    expect(result.usedFallbackRates).toBe(true);
  });

  it('is empty when every requested currency resolved live', async () => {
    findUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1, EUR: 0.9, GBP: 0.8 }));

    const result = await resolveConversionRates('USD', ['EUR', 'GBP']);

    expect(result.fallbackCurrencies).toEqual([]);
    expect(result.usedFallbackRates).toBe(false);
  });

  it('lists every requested currency when the whole base resolution fell back, excluding the viewer currency', async () => {
    findUniqueMock.mockResolvedValue(null); // no cache row
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const result = await resolveConversionRates('USD', ['EUR', 'GBP', 'USD']);

    expect(result.fallbackCurrencies).toEqual(['EUR', 'GBP']);
    expect(result.usedFallbackRates).toBe(true);
  });

  it('uppercases the listed codes regardless of request and target casing', async () => {
    findUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1, EUR: 0.9 })); // no PKR live

    const result = await resolveConversionRates('usd', ['pkr']);

    expect(result.fallbackCurrencies).toEqual(['PKR']);
  });

  it('dedupes repeated requests for the same fallback currency', async () => {
    findUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 })); // no PKR live

    const result = await resolveConversionRates('USD', ['pkr', 'PKR']);

    expect(result.fallbackCurrencies).toEqual(['PKR']);
  });

  it('does not change the existing rates/usedFallbackRates outputs', async () => {
    findUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1, EUR: 0.9 })); // no PKR live

    const result = await resolveConversionRates('USD', ['EUR', 'PKR']);

    expect(result.rates).toMatchObject({ USD: 1, EUR: 0.9 });
    expect(result.rates.PKR).toBeGreaterThan(0);
    expect(result.usedFallbackRates).toBe(true);
  });
});

// spec-WI-072 §1 / story regression-test requirement (a) — getRates()'s
// in-process 60s TTL memo + single-flight, sitting in front of the DB read
// exercised above. Unlike every other describe block in this file, these two
// tests do NOT call resetRatesMemoForTests() between their two getRates()
// calls — that omission is the whole point: within a single test body the
// memo must be left to do its job and coalesce same-base calls into one DB
// read. (The suite's `beforeEach` still clears the memo BETWEEN tests, same
// as every other test here, so these two tests don't pollute each other or
// the rest of the file.)
describe('getRates() in-process memo (spec-WI-072 §1)', () => {
  it('a repeat call for the same base within the memo window skips the second DB read and returns an identical result', async () => {
    findUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1, EUR: 0.9, GBP: 0.8 }));

    const first = await getRates('USD');
    const second = await getRates('USD'); // no resetRatesMemoForTests() in between — the memo is under test

    expect(findUniqueMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('the memo is keyed per base — a memo hit for one base is never served for a different base', async () => {
    findUniqueMock.mockImplementation((call: unknown) => {
      const base = (call as { where: { base: string } }).where.base;
      return Promise.resolve(
        base === 'USD'
          ? freshCacheRow('USD', { USD: 1, EUR: 0.9 })
          : freshCacheRow('EUR', { EUR: 1, USD: 1.11 }),
      );
    });

    const usd = await getRates('USD');
    const eur = await getRates('EUR');

    // One findUnique per distinct base — a memo hit for USD is never served for EUR.
    expect(findUniqueMock).toHaveBeenCalledTimes(2);
    expect(usd.base).toBe('USD');
    expect(eur.base).toBe('EUR');
    expect(usd).not.toEqual(eur);
  });
});

describe('convertAmount', () => {
  it('short-circuits same-currency pairs with no rate lookup and no rounding (Same-currency pair short-circuits)', async () => {
    const result = await convertAmount(12345, 'usd', 'USD');

    expect(result).toEqual({ amount: 12345, source: 'live' });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('rejects an unsupported currency code before any rate lookup (Unsupported currency code requested)', async () => {
    await expect(convertAmount(1000, 'XXX', 'USD')).rejects.toMatchObject({
      statusCode: 400,
      code: 'UNSUPPORTED_CURRENCY',
    });
    await expect(convertAmount(1000, 'USD', 'XXX')).rejects.toMatchObject({
      statusCode: 400,
      code: 'UNSUPPORTED_CURRENCY',
    });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('computes the amount via the same cross-rate + exponent-shift + single-round logic as convert() (Another domain obtains a converted amount)', async () => {
    const rates = { JPY: 1, USD: 0.0066225 };
    findUniqueMock.mockResolvedValue(freshCacheRow('JPY', rates));

    const result = await convertAmount(1050, 'USD', 'JPY');

    expect(result.amount).toBe(convert(1050, 'USD', 'JPY', rates));
    expect(result.source).toBe('live');
  });

  it('preserves precision converting into a 3-decimal currency (Precision is preserved across differing minor-unit currencies)', async () => {
    const rates = { KWD: 1, USD: 3.25 };
    findUniqueMock.mockResolvedValue(freshCacheRow('KWD', rates));

    const result = await convertAmount(999, 'USD', 'KWD');

    expect(result.amount).toBe(convert(999, 'USD', 'KWD', rates));
  });

  it('reports source: fallback when the resolved rate used the bundled table', async () => {
    findUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1 })); // missing GBP live

    const result = await convertAmount(1000, 'GBP', 'USD');

    expect(result.source).toBe('fallback');
  });

  it('reports source: live when every rate came from the live/cached map', async () => {
    findUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1, GBP: 0.8 }));

    const result = await convertAmount(1000, 'GBP', 'USD');

    expect(result.source).toBe('live');
  });
});

describe('convert (existing, unchanged) — the RATE_UNAVAILABLE contract convertAmount reuses', () => {
  it('throws AppError(500, RATE_UNAVAILABLE) when a code is missing from the rates map (Rate cannot be resolved for a required pair)', () => {
    let caught: unknown;
    try {
      convert(1000, 'USD', 'GBP', { USD: 1 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).statusCode).toBe(500);
    expect((caught as AppError).code).toBe('RATE_UNAVAILABLE');
  });
});
