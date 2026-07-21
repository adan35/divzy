import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUniqueMock = vi.fn();
const manualFindUniqueMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    exchangeRateCache: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      upsert: vi.fn(),
    },
    manualExchangeRate: {
      findUnique: (...args: unknown[]) => manualFindUniqueMock(...args),
    },
  },
}));

// Force the automatic chain to be exhaustible for PKR (see rates-unavailable.test.ts
// for why this is the only realistic way to reach RATE_UNAVAILABLE for a supported code).
vi.mock('../src/lib/rates-fallback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/rates-fallback')>();
  const { PKR: _omitted, ...rest } = actual.FALLBACK_RATES;
  return { FALLBACK_RATES: rest };
});

import { convert, convertAmountForUser, resetRatesMemoForTests } from '../src/lib/rates';

function freshCacheRow(base: string, rates: Record<string, number>) {
  return { id: 'cache_1', base, rates, fetchedAt: new Date() };
}

beforeEach(() => {
  findUniqueMock.mockReset();
  manualFindUniqueMock.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
  // WI-072 §1's getRates() memo persists across it() blocks in this file
  // (same base 'USD'/'PKR' re-mocked per test) unless cleared each time.
  resetRatesMemoForTests();
});

// story-WI-002 (analytics) scenarios ------------------------------------------------

describe('convertAmountForUser', () => {
  it('uses the automatic chain when it resolves and never consults the manual table (Automatic rate later becomes available / precedence — ADR-006)', async () => {
    findUniqueMock.mockResolvedValue(freshCacheRow('USD', { USD: 1, PKR: 278 })); // PKR resolvable live

    const result = await convertAmountForUser('user_1', 1000, 'PKR', 'USD');

    expect(result.source).toBe('live');
    expect(manualFindUniqueMock).not.toHaveBeenCalled();
  });

  it('falls back to a stored manual rate, converted with convert()s exact math, once the automatic chain is exhausted (Manual rate is persisted and used)', async () => {
    findUniqueMock.mockResolvedValue(null); // automatic chain exhausted for PKR->USD
    manualFindUniqueMock.mockResolvedValue({
      id: 'manual_1',
      userId: 'user_1',
      fromCurrency: 'PKR',
      toCurrency: 'USD',
      rate: 0.0036,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await convertAmountForUser('user_1', 1000, 'PKR', 'USD');

    expect(result.source).toBe('manual');
    expect(result.amount).toBe(convert(1000, 'PKR', 'USD', { PKR: 1, USD: 0.0036 }));
  });

  it('looks up the manual rate scoped to exactly (userId, fromCurrency, toCurrency) — user-scoped, per-pair, no reciprocal', async () => {
    findUniqueMock.mockResolvedValue(null);
    manualFindUniqueMock.mockResolvedValue(null);

    await expect(convertAmountForUser('user_42', 1000, 'PKR', 'USD')).rejects.toMatchObject({
      code: 'RATE_UNAVAILABLE',
    });

    expect(manualFindUniqueMock).toHaveBeenCalledWith({
      where: {
        userId_fromCurrency_toCurrency: { userId: 'user_42', fromCurrency: 'PKR', toCurrency: 'USD' },
      },
    });
  });

  it('rethrows RATE_UNAVAILABLE unchanged when no manual rate is on file (Missing rate is detected and the user is prompted)', async () => {
    findUniqueMock.mockResolvedValue(null);
    manualFindUniqueMock.mockResolvedValue(null);

    await expect(convertAmountForUser('user_1', 1000, 'PKR', 'USD')).rejects.toMatchObject({
      statusCode: 500,
      code: 'RATE_UNAVAILABLE',
    });
  });

  it('rethrows UNSUPPORTED_CURRENCY immediately without consulting the manual table (out of scope per story)', async () => {
    await expect(convertAmountForUser('user_1', 1000, 'XXX', 'USD')).rejects.toMatchObject({
      statusCode: 400,
      code: 'UNSUPPORTED_CURRENCY',
    });

    expect(manualFindUniqueMock).not.toHaveBeenCalled();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});
