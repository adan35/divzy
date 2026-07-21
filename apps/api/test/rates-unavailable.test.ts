import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUniqueMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    exchangeRateCache: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      upsert: vi.fn(),
    },
  },
}));

// Simulates drift between the 52 supported currencies (@divzy/shared CURRENCIES)
// and the bundled fallback table — the only way a nominally-supported code can
// still be genuinely unresolvable end-to-end, per story-WI-001's "Rate cannot be
// resolved for a required pair" scenario.
vi.mock('../src/lib/rates-fallback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/rates-fallback')>();
  const { PKR: _omitted, ...rest } = actual.FALLBACK_RATES;
  return { FALLBACK_RATES: rest };
});

import { convertAmount } from '../src/lib/rates';

beforeEach(() => {
  findUniqueMock.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
});

describe('convertAmount — rate cannot be resolved for a required pair', () => {
  it('raises AppError(500, RATE_UNAVAILABLE) rather than returning zero/null/unconverted, so callers can detect and trigger WI-002s manual-rate fallback', async () => {
    findUniqueMock.mockResolvedValue(null); // no cache, live fetch fails, and the (mocked) fallback table lacks PKR

    await expect(convertAmount(1000, 'PKR', 'USD')).rejects.toMatchObject({
      statusCode: 500,
      code: 'RATE_UNAVAILABLE',
    });
  });
});
