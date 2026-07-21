// spec-WI-071.md §1.3(a) / story-WI-071.md Scenario Outline, "the caller's own
// stored ManualExchangeRate (WI-002)" fallback-path example — a SEPARATE file
// from wi071-balance-conversion-parallel.test.ts because it needs its own,
// differently-shaped bundled FALLBACK_RATES mock (USD absent, forcing
// tryConvert's automatic-chain retry to fail too, so it falls all the way
// through to the caller's stored manual rate) — `vi.mock` factories are
// static per file, so the two distinct fallback-path variants the AC's
// Scenario Outline calls for cannot share one file's rates-fallback mock.
//
// Also independently re-confirms a pre-existing (not WI-071-introduced)
// subtlety in `tryConvert` that parallelization must not disturb: a
// `source: 'manual'` resolution does NOT set `usedFallbackRates` (only
// `source: 'fallback'` does) — easy to get wrong when touching this code.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const userFindUniqueMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const exchangeRateCacheFindUniqueMock = vi.fn();
const manualExchangeRateFindUniqueMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUniqueMock(...args) },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: { findMany: (...args: unknown[]) => settlementFindManyMock(...args) },
    exchangeRateCache: { findUnique: (...args: unknown[]) => exchangeRateCacheFindUniqueMock(...args) },
    manualExchangeRate: { findUnique: (...args: unknown[]) => manualExchangeRateFindUniqueMock(...args) },
  },
}));

// USD deliberately ABSENT here (unlike the sibling file's table) — the
// batch-level patch must fail for USD, forcing tryConvert past the automatic
// chain and all the way to the manual-rate branch. EUR stays absent too
// (fully unresolvable, matching the AC's third currency).
vi.mock('../src/lib/rates-fallback', () => ({
  FALLBACK_RATES: { GBP: 0.79, PKR: 278 },
}));

import { buildApp } from '../src/app';
import { resetRatesMemoForTests } from '../src/lib/rates';

const ME = 'user_manualconv_me1';
const CP_A = 'user_manualconv_cpa1';
const CP_B = 'user_manualconv_cpb1';
const CP_C = 'user_manualconv_cpc1';

function expense(currency: string, amount: number, payerId: string, owerId: string) {
  return { currency, payers: [{ userId: payerId, amount }], splits: [{ userId: owerId, amount }] };
}

let app: FastifyInstance;

beforeEach(async () => {
  userFindUniqueMock.mockReset().mockResolvedValue({ defaultCurrency: 'GBP' });
  expenseFindManyMock.mockReset().mockResolvedValue([
    expense('PKR', 27_800, ME, CP_A), // ME is owed 27800 PKR (live rate)
    expense('USD', 2_000, CP_B, ME), // ME owes CP_B 2000 USD (manual-rate fallback)
    expense('EUR', 3_000, ME, CP_C), // ME is owed 3000 EUR (fully unresolvable)
  ]);
  settlementFindManyMock.mockReset().mockResolvedValue([]);
  exchangeRateCacheFindUniqueMock.mockReset().mockResolvedValue({
    base: 'GBP',
    rates: { GBP: 1, PKR: 278 }, // missing USD and EUR
    fetchedAt: new Date(),
  });
  manualExchangeRateFindUniqueMock.mockReset().mockImplementation(
    (args: { where: { userId_fromCurrency_toCurrency: { fromCurrency: string; toCurrency: string } } }) => {
      const { fromCurrency, toCurrency } = args.where.userId_fromCurrency_toCurrency;
      if (fromCurrency === 'USD' && toCurrency === 'GBP') {
        return Promise.resolve({ rate: 0.75 }); // ME's own stored USD->GBP rate
      }
      return Promise.resolve(null);
    },
  );
  resetRatesMemoForTests();

  app = await buildApp();
  await app.ready();
});

describe('GET /balance — byte-identical parallel conversion, ManualExchangeRate fallback-path', () => {
  it('USD resolves via the caller\'s stored manual rate; usedFallbackRates stays FALSE for a manual-only resolution', async () => {
    const token = app.jwt.sign({ sub: ME });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/balance',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Hand-computed expected figures:
    //   PKR: round(27800 * (1/278)) = 100 (live)
    //   USD: convert(2000, 'USD', 'GBP', { USD: 1, GBP: 0.75 }) = round(2000*0.75) = 1500 (manual)
    //   EUR: unresolved (no live, no bundled fallback, no manual row)
    expect(body.converted.currency).toBe('GBP');
    expect(body.converted.youAreOwed).toBe(100);
    expect(body.converted.youOwe).toBe(1_500);
    expect(body.converted.total).toBe(100 - 1_500);
    expect(body.converted.unresolved).toEqual([{ currency: 'EUR', amount: 3_000 }]);
    // The load-bearing, easy-to-regress assertion: manual-rate resolution
    // must NOT flip usedFallbackRates to true.
    expect(body.converted.usedFallbackRates).toBe(false);

    expect(manualExchangeRateFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_fromCurrency_toCurrency: { userId: ME, fromCurrency: 'USD', toCurrency: 'GBP' } },
      }),
    );
  });
});
