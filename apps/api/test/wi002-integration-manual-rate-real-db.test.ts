import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// TC-INT-01 — integration level for story-WI-002: POST /api/v1/rates/manual
// -> convertAmountForUser round trip against a REAL database (not mocked
// prisma), exercising the actual Prisma client, the actual
// ManualExchangeRate table/migration, and the actual unique-constraint
// lookup — the boundary every other test in this plan mocks out.
//
// Requires the docker-compose Postgres from apps/api/.env (DATABASE_URL) to
// be reachable; this is the same DB `pnpm dev`/`prisma migrate` use.
//
// Test-plan: .company/domains/analytics/test-plans/test-plan-WI-002.md

// Deliberately NOT mocking '../src/lib/prisma' — this test uses the real
// client end to end.
vi.mock('../src/lib/rates-fallback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/rates-fallback')>();
  // NPR omitted so the automatic chain is genuinely, deterministically
  // exhaustible for NPR->EUR regardless of what's cached/live at test time.
  const { NPR: _omitted, ...rest } = actual.FALLBACK_RATES;
  return { FALLBACK_RATES: rest };
});

import { prisma } from '../src/lib/prisma';
import { convertAmountForUser } from '../src/lib/rates';
import { buildApp } from '../src/app';

let app: FastifyInstance;
let token: string;
let testUserId: string;
const TEST_EMAIL = `test-analytics-wi002-${Date.now()}@test.local`;

// Capture-and-restore the EUR cache row so this test doesn't permanently
// disturb the shared dev cache (the `to` currency for every call below is
// EUR, so it must have no fresh/stale entry during the test to force the
// automatic chain to genuinely miss and fall through to the mocked-empty
// fallback path for NPR).
let savedEurCache: { rates: unknown; fetchedAt: Date } | null = null;

beforeAll(async () => {
  savedEurCache = await prisma.exchangeRateCache.findUnique({ where: { base: 'EUR' } });
  if (savedEurCache) {
    await prisma.exchangeRateCache.delete({ where: { base: 'EUR' } });
  }
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down (integration test)')));

  const user = await prisma.user.create({
    data: {
      email: TEST_EMAIL,
      passwordHash: 'not-a-real-hash',
      name: 'Test Analytics WI-002',
      defaultCurrency: 'EUR',
    },
  });
  testUserId = user.id;

  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: testUserId });
});

afterAll(async () => {
  await app?.close();
  // Cascades to any ManualExchangeRate row created during the test
  // (schema.prisma: onDelete: Cascade).
  await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
  if (savedEurCache) {
    await prisma.exchangeRateCache.upsert({
      where: { base: 'EUR' },
      create: { base: 'EUR', rates: savedEurCache.rates as never, fetchedAt: savedEurCache.fetchedAt },
      update: { rates: savedEurCache.rates as never, fetchedAt: savedEurCache.fetchedAt },
    });
  }
  vi.unstubAllGlobals();
  await prisma.$disconnect();
});

describe('TC-INT-01: POST /rates/manual -> convertAmountForUser round trip against the real test database', () => {
  it('cannot resolve NPR->EUR before any manual rate exists', async () => {
    await expect(convertAmountForUser(testUserId, 100000, 'NPR', 'EUR')).rejects.toMatchObject({
      statusCode: 500,
      code: 'RATE_UNAVAILABLE',
    });
  });

  it('persists a manual rate via the real route and a real DB write', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rates/manual',
      headers: { authorization: `Bearer ${token}` },
      payload: { from: 'NPR', to: 'EUR', rate: 0.0064 }, // 1 NPR = 0.0064 EUR
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ from: 'NPR', to: 'EUR', rate: 0.0064 });

    const row = await prisma.manualExchangeRate.findUnique({
      where: { userId_fromCurrency_toCurrency: { userId: testUserId, fromCurrency: 'NPR', toCurrency: 'EUR' } },
    });
    expect(row).not.toBeNull();
    expect(row?.rate).toBe(0.0064);
    expect(row?.userId).toBe(testUserId); // never a caller-supplied id — real FK, real row
  });

  it('now resolves NPR->EUR using the just-persisted real DB row, with correct minor-unit math', async () => {
    const result = await convertAmountForUser(testUserId, 100000, 'NPR', 'EUR'); // 1000.00 NPR

    expect(result.source).toBe('manual');
    // Hand-computed independent of convert(): both NPR and EUR are 2-decimal
    // currencies (exponentShift = 1). 1000.00 * 0.0064 = 6.40 EUR = 640 minor.
    expect(result.amount).toBe(Math.round(100000 * 0.0064));
    expect(result.amount).toBe(640);
  });

  it('a resubmission upserts (overwrites) the same real row rather than creating a duplicate', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/rates/manual',
      headers: { authorization: `Bearer ${token}` },
      payload: { from: 'NPR', to: 'EUR', rate: 0.0065 },
    });
    expect(res.statusCode).toBe(200);

    const rows = await prisma.manualExchangeRate.findMany({
      where: { userId: testUserId, fromCurrency: 'NPR', toCurrency: 'EUR' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].rate).toBe(0.0065);
  });
});
