// spec-WI-071.md §1.3 / story-WI-071.md "Array ordering is preserved
// regardless of which concurrent conversion settles first" — the scenario
// specifically designed to catch a plausible-but-wrong implementation that
// builds the output array from RESOLUTION order rather than INPUT order.
//
// `convert()` is mocked to always throw RATE_UNAVAILABLE (forcing every
// tryConvert call through the async convertAmountForUser branch, the only
// place a real await/timing gap exists), and `convertAmountForUser` is
// mocked with a PER-CURRENCY delay chosen so the currency that is FIRST in
// the members/pairwise arrays resolves FASTEST and a LATER one resolves
// SLOWEST — the exact "a later item's conversion resolves before an
// earlier one's" case story-WI-071.md's edge cases call out. Each currency
// also gets its own distinctly-identifiable converted amount, so a bug that
// mixes up WHICH result attaches to WHICH row (not just wrong order) would
// also be caught.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const userFindUniqueMock = vi.fn();
const userFindManyMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();
const groupMemberFindFirstMock = vi.fn();
const groupMemberFindManyMock = vi.fn();
const exchangeRateCacheFindUniqueMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
      findMany: (...args: unknown[]) => userFindManyMock(...args),
    },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: { findMany: (...args: unknown[]) => settlementFindManyMock(...args) },
    groupMember: {
      findFirst: (...args: unknown[]) => groupMemberFindFirstMock(...args),
      findMany: (...args: unknown[]) => groupMemberFindManyMock(...args),
    },
    exchangeRateCache: { findUnique: (...args: unknown[]) => exchangeRateCacheFindUniqueMock(...args) },
  },
}));

/** Per-currency delay (ms) + a distinctly-identifiable "converted" amount,
 *  chosen so the FIRST array item (JPY) resolves fastest and a LATER one
 *  (AUD) resolves slowest — resolution order != array order. */
const CONVERT_BEHAVIOR: Record<string, { delayMs: number; amount: number }> = {
  JPY: { delayMs: 5, amount: 8_001 },
  AUD: { delayMs: 30, amount: 8_002 },
  CAD: { delayMs: 15, amount: 8_003 },
};

const convertAmountForUserMock = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/rates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/rates')>();
  const { AppError } = await import('../src/lib/errors');
  return {
    ...actual,
    convert: vi.fn(() => {
      throw new AppError(500, 'RATE_UNAVAILABLE', 'forced RATE_UNAVAILABLE for the ordering test');
    }),
    convertAmountForUser: (...args: Parameters<typeof actual.convertAmountForUser>) =>
      convertAmountForUserMock(...args),
  };
});

import { buildApp } from '../src/app';
import { resetRatesMemoForTests } from '../src/lib/rates';

const GROUP_ID = 'group_order_fixture_01';
const M1 = 'user_order_m1_00001'; // JPY balance — resolves fastest, but FIRST in the array
const M2 = 'user_order_m2_00001'; // AUD balance — resolves slowest, but SECOND in the array
const M3 = 'user_order_m3_00001'; // CAD balance — resolves mid-speed, THIRD in the array
const GHOST_1 = 'user_order_ghost1_1'; // owes M1 (JPY)
const GHOST_2 = 'user_order_ghost2_1'; // M2 owes this ghost (AUD)
const GHOST_3 = 'user_order_ghost3_1'; // owes M3 (CAD)

function publicUser(id: string, name: string) {
  return { id, name, avatarColor: '#2a78d6', avatarUrl: null };
}

function expense(currency: string, amount: number, payerId: string, owerId: string, groupId: string) {
  return { groupId, currency, payers: [{ userId: payerId, amount }], splits: [{ userId: owerId, amount }] };
}

let app: FastifyInstance;

beforeEach(async () => {
  userFindUniqueMock.mockReset().mockResolvedValue({ defaultCurrency: 'GBP' });
  userFindManyMock.mockReset().mockResolvedValue([]); // "Former member" fallback for ghost counterparties
  settlementFindManyMock.mockReset().mockResolvedValue([]);
  groupMemberFindFirstMock.mockReset().mockResolvedValue({ id: 'gm_viewer' });
  groupMemberFindManyMock.mockReset().mockImplementation((args: { where: Record<string, unknown> }) => {
    if ('groupId' in args.where) {
      return Promise.resolve([
        { userId: M1, leftAt: null, user: publicUser(M1, 'Order One') },
        { userId: M2, leftAt: null, user: publicUser(M2, 'Order Two') },
        { userId: M3, leftAt: null, user: publicUser(M3, 'Order Three') },
      ]);
    }
    return Promise.resolve([
      { userId: M1, groupId: GROUP_ID },
      { userId: M2, groupId: GROUP_ID },
      { userId: M3, groupId: GROUP_ID },
    ]);
  });
  expenseFindManyMock.mockReset().mockResolvedValue([
    expense('JPY', 500, M1, GHOST_1, GROUP_ID), // M1 net +500 JPY (ghost1 owes M1)
    expense('AUD', 300, GHOST_2, M2, GROUP_ID), // M2 net -300 AUD (M2 owes ghost2)
    expense('CAD', 700, M3, GHOST_3, GROUP_ID), // M3 net +700 CAD (ghost3 owes M3)
  ]);
  exchangeRateCacheFindUniqueMock.mockReset().mockResolvedValue({
    base: 'GBP',
    rates: { GBP: 1 },
    fetchedAt: new Date(),
  });
  resetRatesMemoForTests();

  convertAmountForUserMock.mockReset();
  convertAmountForUserMock.mockImplementation(
    (_userId: string, _amount: number, from: string, _to: string) =>
      new Promise((resolve) => {
        const behavior = CONVERT_BEHAVIOR[from];
        setTimeout(() => resolve({ amount: behavior!.amount, source: 'fallback' }), behavior!.delayMs);
      }),
  );

  app = await buildApp();
  await app.ready();
});

describe('GET /groups/:groupId/balances — array ordering survives out-of-order resolution', () => {
  it('members stay in input order (M1,M2,M3) and pairwise stays in sorted order (AUD,CAD,JPY), even though AUD resolves last', async () => {
    const token = app.jwt.sign({ sub: M1 });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${GROUP_ID}/balances`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Members: input order preserved (M1, M2, M3), each with ITS OWN currency's
    // identifiable converted amount — not shuffled or mismatched by resolution timing.
    expect(body.members.map((m: { user: { id: string } }) => m.user.id)).toEqual([M1, M2, M3]);
    expect(body.members[0].convertedNet.amount).toBe(8_001); // M1 -> JPY
    expect(body.members[1].convertedNet.amount).toBe(8_002); // M2 -> AUD (resolves LAST, still 2nd in array)
    expect(body.members[2].convertedNet.amount).toBe(8_003); // M3 -> CAD

    // Pairwise: deterministic sort order (currency, then fromUserId, then
    // toUserId) preserved regardless of resolution timing: AUD, CAD, JPY.
    expect(body.pairwise.map((p: { currency: string }) => p.currency)).toEqual(['AUD', 'CAD', 'JPY']);
    const [audRow, cadRow, jpyRow] = body.pairwise;
    expect(audRow).toMatchObject({ fromUserId: M2, toUserId: GHOST_2, convertedAmount: 8_002 });
    expect(cadRow).toMatchObject({ fromUserId: GHOST_3, toUserId: M3, convertedAmount: 8_003 });
    expect(jpyRow).toMatchObject({ fromUserId: GHOST_1, toUserId: M1, convertedAmount: 8_001 });

    expect(body.usedFallbackRates).toBe(true);
    // Sanity: every currency really did go through the mocked async fallback
    // path (proves the test actually exercises concurrent resolution, not a
    // no-op where convert() secretly succeeded).
    expect(convertAmountForUserMock).toHaveBeenCalledTimes(6); // 3 members + 3 pairwise rows
  });
});
