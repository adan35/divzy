import { beforeEach, describe, expect, it, vi } from 'vitest';

// spec-WI-014 (analytics) §2 — rate-as-of-date resolution: convertAmountsAsOf /
// convertAmountAsOf. See ADR-012 for the rateBasis contract and the per-item
// batch-degradation shape (DRB R1 fix).

const exchangeRateCacheFindUniqueMock = vi.fn();
const exchangeRateCacheUpsertMock = vi.fn();
const exchangeRateSnapshotFindUniqueMock = vi.fn();
const exchangeRateSnapshotCreateManyMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    exchangeRateCache: {
      findUnique: (...args: unknown[]) => exchangeRateCacheFindUniqueMock(...args),
      upsert: (...args: unknown[]) => exchangeRateCacheUpsertMock(...args),
    },
    exchangeRateSnapshot: {
      findUnique: (...args: unknown[]) => exchangeRateSnapshotFindUniqueMock(...args),
      createMany: (...args: unknown[]) => exchangeRateSnapshotCreateManyMock(...args),
    },
  },
}));

import { AppError } from '../src/lib/errors';
import { convertAmountAsOf, convertAmountsAsOf, getRates, resetRatesMemoForTests } from '../src/lib/rates';

/** A fresh (< 12h old) ExchangeRateCache row for `base`. */
function freshCacheRow(base: string, rates: Record<string, number>) {
  return { id: 'cache_1', base, rates, fetchedAt: new Date() };
}

const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000);
const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
const TOMORROW = new Date(Date.now() + 24 * 60 * 60 * 1000);

beforeEach(() => {
  exchangeRateCacheFindUniqueMock.mockReset();
  exchangeRateCacheUpsertMock.mockReset();
  exchangeRateSnapshotFindUniqueMock.mockReset();
  exchangeRateSnapshotCreateManyMock.mockReset();
  vi.unstubAllGlobals();
  // WI-072 §1's getRates() memo persists across it() blocks in this file
  // (same base 'USD' re-mocked per test) unless cleared each time.
  resetRatesMemoForTests();
});

describe('convertAmountsAsOf', () => {
  it('throws 400 UNSUPPORTED_CURRENCY for a bad shared `to` — whole-call throw', async () => {
    await expect(
      convertAmountsAsOf('XXX', [{ amount: 1000, from: 'USD', asOfDate: YESTERDAY }]),
    ).rejects.toMatchObject({ statusCode: 400, code: 'UNSUPPORTED_CURRENCY' });
    expect(exchangeRateSnapshotFindUniqueMock).not.toHaveBeenCalled();
  });

  it('exact-snapshot hit: uses the snapshot map and reports rateBasis "exact"', async () => {
    exchangeRateSnapshotFindUniqueMock.mockResolvedValue({
      id: 'snap_1',
      base: 'USD',
      date: YESTERDAY,
      rates: { USD: 1, EUR: 0.9 },
      capturedAt: YESTERDAY,
    });

    const [result] = await convertAmountsAsOf('USD', [
      { amount: 1000, from: 'EUR', asOfDate: YESTERDAY },
    ]);

    expect(result).toMatchObject({ status: 'ok', rateBasis: 'exact' });
    expect(exchangeRateCacheFindUniqueMock).not.toHaveBeenCalled();
  });

  it('gap-day approximation: no snapshot for the day, resolves via today\'s live/cached rate as "approximated"', async () => {
    exchangeRateSnapshotFindUniqueMock.mockResolvedValue(null);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1, EUR: 0.9 }));

    const [result] = await convertAmountsAsOf('USD', [
      { amount: 1000, from: 'EUR', asOfDate: YESTERDAY },
    ]);

    expect(result).toMatchObject({ status: 'ok', rateBasis: 'approximated' });
  });

  it('predates-capture: an old asOfDate with no snapshot still resolves via today\'s rate, never errors', async () => {
    exchangeRateSnapshotFindUniqueMock.mockResolvedValue(null);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1, EUR: 0.9 }));

    const [result] = await convertAmountsAsOf('USD', [
      { amount: 1000, from: 'EUR', asOfDate: TWO_DAYS_AGO },
    ]);

    expect(result.status).toBe('ok');
    expect((result as { rateBasis: string }).rateBasis).toBe('approximated');
  });

  it('fallback-origin: no snapshot and today\'s rate itself falls back to the bundled table -> "fallback"', async () => {
    exchangeRateSnapshotFindUniqueMock.mockResolvedValue(null);
    exchangeRateCacheFindUniqueMock.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const [result] = await convertAmountsAsOf('USD', [
      { amount: 1000, from: 'EUR', asOfDate: YESTERDAY },
    ]);

    expect(result).toMatchObject({ status: 'ok', rateBasis: 'fallback' });
  });

  it('same-currency short-circuit: rateBasis "exact", no snapshot/cache lookup, no rounding drift', async () => {
    const [result] = await convertAmountsAsOf('USD', [
      { amount: 12345, from: 'usd', asOfDate: YESTERDAY },
    ]);

    expect(result).toEqual({ status: 'ok', amount: 12345, rateBasis: 'exact' });
    expect(exchangeRateSnapshotFindUniqueMock).not.toHaveBeenCalled();
    expect(exchangeRateCacheFindUniqueMock).not.toHaveBeenCalled();
  });

  it('per-item unresolved for a bad `from` — sibling valid item in the same batch still resolves ok', async () => {
    exchangeRateSnapshotFindUniqueMock.mockResolvedValue({
      id: 'snap_1',
      base: 'USD',
      date: YESTERDAY,
      rates: { USD: 1, EUR: 0.9 },
      capturedAt: YESTERDAY,
    });

    const [bad, good] = await convertAmountsAsOf('USD', [
      { amount: 1000, from: 'ZZZ', asOfDate: YESTERDAY },
      { amount: 1000, from: 'EUR', asOfDate: YESTERDAY },
    ]);

    expect(bad).toEqual({ status: 'unresolved', reason: 'UNSUPPORTED_CURRENCY' });
    expect(good).toMatchObject({ status: 'ok', rateBasis: 'exact' });
  });

  it('per-item unresolved for a future/invalid asOfDate — sibling valid item in the same batch still resolves ok', async () => {
    exchangeRateSnapshotFindUniqueMock.mockResolvedValue({
      id: 'snap_1',
      base: 'USD',
      date: YESTERDAY,
      rates: { USD: 1, EUR: 0.9 },
      capturedAt: YESTERDAY,
    });

    const [future, invalid, good] = await convertAmountsAsOf('USD', [
      { amount: 1000, from: 'EUR', asOfDate: TOMORROW },
      { amount: 1000, from: 'EUR', asOfDate: 'not-a-date' },
      { amount: 1000, from: 'EUR', asOfDate: YESTERDAY },
    ]);

    expect(future).toEqual({ status: 'unresolved', reason: 'INVALID_AS_OF_DATE' });
    expect(invalid).toEqual({ status: 'unresolved', reason: 'INVALID_AS_OF_DATE' });
    expect(good).toMatchObject({ status: 'ok', rateBasis: 'exact' });
  });

  it('batch de-duplication by day: two items on the same UTC day issue exactly one snapshot lookup', async () => {
    exchangeRateSnapshotFindUniqueMock.mockResolvedValue({
      id: 'snap_1',
      base: 'USD',
      date: YESTERDAY,
      rates: { USD: 1, EUR: 0.9, GBP: 0.8 },
      capturedAt: YESTERDAY,
    });

    await convertAmountsAsOf('USD', [
      { amount: 1000, from: 'EUR', asOfDate: YESTERDAY },
      { amount: 2000, from: 'GBP', asOfDate: YESTERDAY },
    ]);

    expect(exchangeRateSnapshotFindUniqueMock).toHaveBeenCalledTimes(1);
  });

  it('an unresolvable/future date on one item never triggers a lookup for that item and does not affect other days', async () => {
    exchangeRateSnapshotFindUniqueMock.mockResolvedValue({
      id: 'snap_1',
      base: 'USD',
      date: YESTERDAY,
      rates: { USD: 1, EUR: 0.9 },
      capturedAt: YESTERDAY,
    });

    const [future, ok] = await convertAmountsAsOf('USD', [
      { amount: 1000, from: 'EUR', asOfDate: TOMORROW },
      { amount: 1000, from: 'EUR', asOfDate: YESTERDAY },
    ]);

    expect(future).toEqual({ status: 'unresolved', reason: 'INVALID_AS_OF_DATE' });
    expect(ok).toMatchObject({ status: 'ok', rateBasis: 'exact' });
    // Only one distinct resolvable day (yesterday) -> exactly one lookup.
    expect(exchangeRateSnapshotFindUniqueMock).toHaveBeenCalledTimes(1);
  });
});

describe('convertAmountAsOf (single-item convenience)', () => {
  it('returns the bare { amount, rateBasis } shape on success', async () => {
    exchangeRateSnapshotFindUniqueMock.mockResolvedValue({
      id: 'snap_1',
      base: 'USD',
      date: YESTERDAY,
      rates: { USD: 1, EUR: 0.9 },
      capturedAt: YESTERDAY,
    });

    const result = await convertAmountAsOf(1000, 'EUR', 'USD', YESTERDAY);

    expect(result).toMatchObject({ rateBasis: 'exact' });
    expect(typeof result.amount).toBe('number');
  });

  it('rethrows an unresolved bad `from` as 400 UNSUPPORTED_CURRENCY', async () => {
    await expect(convertAmountAsOf(1000, 'ZZZ', 'USD', YESTERDAY)).rejects.toMatchObject({
      statusCode: 400,
      code: 'UNSUPPORTED_CURRENCY',
    });
  });

  it('rethrows an unresolved future asOfDate as 400 INVALID_AS_OF_DATE', async () => {
    await expect(convertAmountAsOf(1000, 'EUR', 'USD', TOMORROW)).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_AS_OF_DATE',
    });
  });

  it('still throws 400 UNSUPPORTED_CURRENCY for a bad `to`', async () => {
    await expect(convertAmountAsOf(1000, 'EUR', 'XXX', YESTERDAY)).rejects.toMatchObject({
      statusCode: 400,
      code: 'UNSUPPORTED_CURRENCY',
    });
  });

  it('is an AppError instance for both throw paths', async () => {
    let caught: unknown;
    try {
      await convertAmountAsOf(1000, 'EUR', 'USD', TOMORROW);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
  });
});

describe('getRates() — best-effort ExchangeRateSnapshot write on fresh live fetch', () => {
  it('writes a create-if-absent snapshot for (base, today-UTC) after a successful live fetch', async () => {
    exchangeRateCacheFindUniqueMock.mockResolvedValue(null); // no cache -> forces live fetch
    exchangeRateCacheUpsertMock.mockResolvedValue({});
    exchangeRateSnapshotCreateManyMock.mockResolvedValue({ count: 1 });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: 'success', rates: { USD: 1, EUR: 0.9 } }),
      }),
    );

    const result = await getRates('USD');

    expect(result.source).toBe('live');
    expect(exchangeRateSnapshotCreateManyMock).toHaveBeenCalledTimes(1);
    const call = exchangeRateSnapshotCreateManyMock.mock.calls[0][0];
    expect(call.data[0]).toMatchObject({ base: 'USD' });
    expect(call.skipDuplicates).toBe(true);
  });

  it('does not write a snapshot when serving from fresh cache (no live fetch)', async () => {
    exchangeRateCacheFindUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1, EUR: 0.9 }));

    const result = await getRates('USD');

    expect(result.source).toBe('live');
    expect(exchangeRateSnapshotCreateManyMock).not.toHaveBeenCalled();
  });

  it('does not write a snapshot when falling back to stale cache after a failed live fetch', async () => {
    exchangeRateCacheFindUniqueMock.mockResolvedValue({
      id: 'cache_1',
      base: 'USD',
      rates: { USD: 1, EUR: 0.9 },
      fetchedAt: new Date(Date.now() - 13 * 60 * 60 * 1000), // stale (>12h)
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const result = await getRates('USD');

    expect(result.source).toBe('live'); // stale cache is still live-origin
    expect(exchangeRateSnapshotCreateManyMock).not.toHaveBeenCalled();
  });

  it('does not write a snapshot on the bundled-fallback branch', async () => {
    exchangeRateCacheFindUniqueMock.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const result = await getRates('USD');

    expect(result.source).toBe('fallback');
    expect(exchangeRateSnapshotCreateManyMock).not.toHaveBeenCalled();
  });

  it('a snapshot-write failure is swallowed and never breaks getRates()\'s return contract', async () => {
    exchangeRateCacheFindUniqueMock.mockResolvedValue(null);
    exchangeRateCacheUpsertMock.mockResolvedValue({});
    exchangeRateSnapshotCreateManyMock.mockRejectedValue(new Error('db write failed'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: 'success', rates: { USD: 1, EUR: 0.9 } }),
      }),
    );

    const result = await getRates('USD');

    expect(result.source).toBe('live');
    expect(result.rates.EUR).toBe(0.9);
  });
});
