import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExpenseDto } from '@divzy/shared';

// spec-WI-014 (expenses) §4 — enrichExpensesWithConverted's bucketing/degradation
// logic. The analytics `convertAmountsAsOf` boundary is mocked here (a normal unit-
// test seam for an external dependency's interface — distinct from stubbing
// analytics' own decision logic, which expenses must never do in production code).

const userFindUniqueMock = vi.fn();
const convertAmountsAsOfMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
    },
  },
}));

vi.mock('../src/lib/rates', () => ({
  convertAmountsAsOf: (...args: unknown[]) => convertAmountsAsOfMock(...args),
}));

import { enrichExpensesWithConverted } from '../src/lib/expense-conversion';

function makeExpenseDto(overrides: Partial<ExpenseDto> = {}): ExpenseDto {
  return {
    id: 'exp-1',
    groupId: null,
    group: null,
    description: 'Dinner',
    amount: 1000,
    currency: 'USD',
    category: 'GENERAL',
    date: '2026-07-01T00:00:00.000Z',
    splitType: 'EQUAL',
    notes: null,
    receiptUrl: null,
    payers: [],
    splits: [],
    items: [],
    createdBy: { id: 'u1', name: 'Alice', avatarColor: '#fff' },
    updatedBy: null,
    commentCount: 0,
    deletedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  userFindUniqueMock.mockReset();
  convertAmountsAsOfMock.mockReset();
  userFindUniqueMock.mockResolvedValue({ defaultCurrency: 'GBP' });
});

describe('enrichExpensesWithConverted', () => {
  it('skips a same-currency row entirely (D6) — no converted block, and never forwarded to analytics', async () => {
    const dto = makeExpenseDto({ groupId: null, group: null, currency: 'GBP' }); // viewer default is GBP

    const [result] = await enrichExpensesWithConverted([dto], 'viewer-1');

    expect(result.convertedAmount).toBeUndefined();
    expect(result.convertedCurrency).toBeUndefined();
    expect(result.rateBasis).toBeUndefined();
    expect(result.isApproximateRate).toBeUndefined();
    expect(convertAmountsAsOfMock).not.toHaveBeenCalled();
  });

  it('converts a single bucket of rows sharing one target currency with exactly one analytics call', async () => {
    const dtoA = makeExpenseDto({ id: 'a', currency: 'USD', amount: 1000 });
    const dtoB = makeExpenseDto({ id: 'b', currency: 'USD', amount: 2000 });
    // both direct expenses -> target = viewer default (GBP)
    convertAmountsAsOfMock.mockResolvedValue([
      { status: 'ok', amount: 790, rateBasis: 'exact' },
      { status: 'ok', amount: 1580, rateBasis: 'exact' },
    ]);

    const [a, b] = await enrichExpensesWithConverted([dtoA, dtoB], 'viewer-1');

    expect(convertAmountsAsOfMock).toHaveBeenCalledTimes(1);
    expect(convertAmountsAsOfMock).toHaveBeenCalledWith('GBP', [
      { amount: 1000, from: 'USD', asOfDate: dtoA.date },
      { amount: 2000, from: 'USD', asOfDate: dtoB.date },
    ]);
    expect(a.convertedAmount).toBe(790);
    expect(a.convertedCurrency).toBe('GBP');
    expect(a.rateBasis).toBe('exact');
    expect(a.isApproximateRate).toBe(false);
    expect(b.convertedAmount).toBe(1580);
  });

  it('buckets rows by their own target currency, issuing one analytics call per distinct target', async () => {
    // Group expense targets its own group's currency (EUR); direct expense targets viewer default (GBP).
    const groupDto = makeExpenseDto({
      id: 'g',
      groupId: 'grp-1',
      group: { id: 'grp-1', name: 'Trip', emoji: '', currency: 'EUR' },
      currency: 'USD',
      amount: 500,
    });
    const directDto = makeExpenseDto({ id: 'd', groupId: null, group: null, currency: 'USD', amount: 300 });

    convertAmountsAsOfMock.mockImplementation(async (to: string) => {
      if (to === 'EUR') return [{ status: 'ok', amount: 460, rateBasis: 'approximated' }];
      if (to === 'GBP') return [{ status: 'ok', amount: 240, rateBasis: 'fallback' }];
      throw new Error(`unexpected target ${to}`);
    });

    const [g, d] = await enrichExpensesWithConverted([groupDto, directDto], 'viewer-1');

    expect(convertAmountsAsOfMock).toHaveBeenCalledTimes(2);
    expect(g.convertedAmount).toBe(460);
    expect(g.convertedCurrency).toBe('EUR');
    expect(g.rateBasis).toBe('approximated');
    expect(g.isApproximateRate).toBe(true);
    expect(d.convertedAmount).toBe(240);
    expect(d.convertedCurrency).toBe('GBP');
    expect(d.rateBasis).toBe('fallback');
    expect(d.isApproximateRate).toBe(true);
  });

  it('isolates a failing bucket (D7) — the failing target omits its rows converted block, other buckets still succeed', async () => {
    const eurDto = makeExpenseDto({
      id: 'g',
      groupId: 'grp-1',
      group: { id: 'grp-1', name: 'Trip', emoji: '', currency: 'EUR' },
      currency: 'USD',
      amount: 500,
    });
    const gbpDto = makeExpenseDto({ id: 'd', groupId: null, group: null, currency: 'USD', amount: 300 });

    convertAmountsAsOfMock.mockImplementation(async (to: string) => {
      if (to === 'EUR') throw new Error('boom — unsupported shared `to` currency');
      if (to === 'GBP') return [{ status: 'ok', amount: 240, rateBasis: 'exact' }];
      throw new Error(`unexpected target ${to}`);
    });

    const [g, d] = await enrichExpensesWithConverted([eurDto, gbpDto], 'viewer-1');

    expect(g.convertedAmount).toBeUndefined();
    expect(g.convertedCurrency).toBeUndefined();
    expect(g.rateBasis).toBeUndefined();
    expect(g.isApproximateRate).toBeUndefined();

    expect(d.convertedAmount).toBe(240);
    expect(d.convertedCurrency).toBe('GBP');
  });

  it('derives isApproximateRate = false only for rateBasis "exact"; true for "approximated" and "fallback" (§6)', async () => {
    const dtos = [
      makeExpenseDto({ id: 'x', currency: 'USD', amount: 100 }),
      makeExpenseDto({ id: 'y', currency: 'USD', amount: 200 }),
      makeExpenseDto({ id: 'z', currency: 'USD', amount: 300 }),
    ];
    convertAmountsAsOfMock.mockResolvedValue([
      { status: 'ok', amount: 79, rateBasis: 'exact' },
      { status: 'ok', amount: 158, rateBasis: 'approximated' },
      { status: 'ok', amount: 237, rateBasis: 'fallback' },
    ]);

    const [x, y, z] = await enrichExpensesWithConverted(dtos, 'viewer-1');

    expect(x.rateBasis).toBe('exact');
    expect(x.isApproximateRate).toBe(false);
    expect(y.rateBasis).toBe('approximated');
    expect(y.isApproximateRate).toBe(true);
    expect(z.rateBasis).toBe('fallback');
    expect(z.isApproximateRate).toBe(true);
  });

  it('returns the input array unchanged (empty) without loading the viewer or calling analytics', async () => {
    const result = await enrichExpensesWithConverted([], 'viewer-1');

    expect(result).toEqual([]);
    expect(userFindUniqueMock).not.toHaveBeenCalled();
    expect(convertAmountsAsOfMock).not.toHaveBeenCalled();
  });

  it('degrades per item (DRB R1) — one unresolved item in a bucket does not strip its ok sibling in the same bucket, via a single analytics call', async () => {
    const okDto = makeExpenseDto({ id: 'ok', currency: 'USD', amount: 1000 });
    const unresolvedDto = makeExpenseDto({ id: 'bad', currency: 'USD', amount: 500 });
    // both direct expenses -> same target bucket (viewer default GBP)
    convertAmountsAsOfMock.mockResolvedValue([
      { status: 'ok', amount: 790, rateBasis: 'exact' },
      { status: 'unresolved', reason: 'INVALID_AS_OF_DATE' },
    ]);

    const [ok, unresolved] = await enrichExpensesWithConverted([okDto, unresolvedDto], 'viewer-1');

    expect(convertAmountsAsOfMock).toHaveBeenCalledTimes(1);
    expect(ok.convertedAmount).toBe(790);
    expect(ok.convertedCurrency).toBe('GBP');
    expect(ok.rateBasis).toBe('exact');
    expect(ok.isApproximateRate).toBe(false);

    expect(unresolved.convertedAmount).toBeUndefined();
    expect(unresolved.convertedCurrency).toBeUndefined();
    expect(unresolved.rateBasis).toBeUndefined();
    expect(unresolved.isApproximateRate).toBeUndefined();
  });
});
