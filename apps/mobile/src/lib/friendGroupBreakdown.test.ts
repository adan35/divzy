import { describe, expect, it } from 'vitest';
import { formatMoney, type CurrencyAmount, type FriendBalanceBucket } from '@divzy/shared';
import {
  BREAKDOWN_OVERFLOW_THRESHOLD,
  BREAKDOWN_OVERFLOW_VISIBLE,
  breakdownCaption,
  breakdownExpandable,
  breakdownRow,
  bucketKey,
  bucketLabel,
  visibleBreakdownRows,
} from './friendGroupBreakdown';

// Tests written from spec-WI-079 §5/§6.3 (mobile per-group breakdown row
// derivation) before friendGroupBreakdown.ts exists (TDD red). Mobile has no
// RN component-test harness (vitest.config.ts), so per the WI-062/WI-074
// precedent every derivable decision lives in this pure module:
//   D6  collapsed-by-default — the component's `useState(false)`; the module
//       owns everything downstream of the toggle.
//   D8  direct bucket copy — exactly "Direct expenses", no emoji.
//   D10 overflow — >5 buckets renders the first 4 + "+N more groups" toggle.
//   D11 expand affordance suppressed iff balancesByGroup.length <= 1,
//       governed by bucket count, NEVER the friend's overall settled state.
//   D12 per-bucket amounts reuse collapsedBalanceEntries.
//   D9  per-bucket est. rate flag passes through per bucket, never blanket.

function bucket(overrides: Partial<FriendBalanceBucket> = {}): FriendBalanceBucket {
  return {
    group: { id: 'g1', name: 'Trip to Lahore', emoji: '🌴' },
    balances: [],
    balancesNative: [],
    balancesConverted: { currency: 'USD', amount: 30000 },
    usedFallbackRates: false,
    ...overrides,
  };
}

describe('breakdownExpandable (D11)', () => {
  it('zero buckets → no affordance', () => {
    expect(breakdownExpandable([])).toBe(false);
  });

  it('exactly one bucket → affordance suppressed (would duplicate the collapsed row)', () => {
    expect(breakdownExpandable([bucket()])).toBe(false);
  });

  it('two or more buckets → affordance present', () => {
    expect(breakdownExpandable([bucket(), bucket({ group: null })])).toBe(true);
  });

  it('is governed by bucket count, never the collapsed net — a cross-bucket-cancel pair keeps the affordance', () => {
    // R3: +100 / −100 same currency across two groups nets to zero top-level,
    // but BOTH nonzero buckets exist so the breakdown stays expandable.
    const a = bucket({ group: { id: 'g1', name: 'A', emoji: '🏠' }, balancesConverted: { currency: 'USD', amount: 10000 } });
    const b = bucket({ group: { id: 'g2', name: 'B', emoji: '✈️' }, balancesConverted: { currency: 'USD', amount: -10000 } });
    expect(breakdownExpandable([a, b])).toBe(true);
  });
});

describe('bucketLabel / bucketKey (D8)', () => {
  it('group bucket → "{emoji} {name}"', () => {
    expect(bucketLabel(bucket())).toBe('🌴 Trip to Lahore');
    expect(bucketKey(bucket())).toBe('g1');
  });

  it('direct (group: null) bucket → exactly "Direct expenses", no emoji', () => {
    const direct = bucket({ group: null });
    expect(bucketLabel(direct)).toBe('Direct expenses');
    expect(direct.group).toBeNull();
    expect(bucketKey(direct)).toBe('direct');
  });
});

describe('breakdownRow (D9/D12)', () => {
  it('entries reuse collapsedBalanceEntries: converted line first, then native leftovers', () => {
    const row = breakdownRow(
      'Sam',
      bucket({
        balancesConverted: { currency: 'USD', amount: 30000 },
        balances: [{ currency: 'PKR', amount: 47516 }],
      }),
    );
    expect(row.entries).toEqual([
      { currency: 'USD', amount: 30000 },
      { currency: 'PKR', amount: 47516 },
    ]);
  });

  it('a zero converted figure collapses away, leaving leftovers only', () => {
    const row = breakdownRow(
      'Sam',
      bucket({
        balancesConverted: { currency: 'USD', amount: 0 },
        balances: [{ currency: 'PKR', amount: -1250 }],
      }),
    );
    expect(row.entries).toEqual([{ currency: 'PKR', amount: -1250 }]);
  });

  it('per-bucket fallback flag passes through per bucket, never blanket', () => {
    const flagged = breakdownRow('Sam', bucket({ usedFallbackRates: true }));
    const clean = breakdownRow('Sam', bucket({ usedFallbackRates: false }));
    expect(flagged.usedFallbackRates).toBe(true);
    expect(clean.usedFallbackRates).toBe(false);
  });

  it('marks the direct bucket distinctly from group buckets', () => {
    expect(breakdownRow('Sam', bucket({ group: null })).direct).toBe(true);
    expect(breakdownRow('Sam', bucket()).direct).toBe(false);
  });
});

describe('breakdownCaption (D7 direction phrasing, mobile sentence convention)', () => {
  const entries = (list: CurrencyAmount[]) => list;

  it('positive → "{name} owes you …" (friend owes viewer)', () => {
    expect(breakdownCaption('Sam Lee', entries([{ currency: 'USD', amount: 500 }]))).toBe(
      `Sam Lee owes you ${formatMoney(500, 'USD')}`,
    );
  });

  it('negative → "You owe {name} …"', () => {
    expect(breakdownCaption('Sam Lee', entries([{ currency: 'USD', amount: -500 }]))).toBe(
      `You owe Sam Lee ${formatMoney(500, 'USD')}`,
    );
  });

  it('multi-currency bucket appends the existing "+N more" tail convention', () => {
    expect(
      breakdownCaption(
        'Sam',
        entries([
          { currency: 'USD', amount: 30000 },
          { currency: 'PKR', amount: 47516 },
          { currency: 'EUR', amount: 100 },
        ]),
      ),
    ).toBe(`Sam owes you ${formatMoney(30000, 'USD')} · +2 more`);
  });

  it('no entries → null caption (defensive; buckets are nonzero by contract)', () => {
    expect(breakdownCaption('Sam', [])).toBeNull();
  });
});

describe('visibleBreakdownRows (D10 overflow)', () => {
  const many = (n: number): FriendBalanceBucket[] =>
    Array.from({ length: n }, (_, i) =>
      bucket({ group: { id: `g${i + 1}`, name: `Group ${i + 1}`, emoji: '🏠' } }),
    );

  it('≤ threshold renders every bucket, no overflow line', () => {
    const { rows, hiddenCount } = visibleBreakdownRows('Sam', many(BREAKDOWN_OVERFLOW_THRESHOLD), false);
    expect(rows).toHaveLength(BREAKDOWN_OVERFLOW_THRESHOLD);
    expect(hiddenCount).toBe(0);
  });

  it('> threshold renders the first 4 magnitude-sorted buckets + hiddenCount for the "+N more groups" toggle', () => {
    const { rows, hiddenCount } = visibleBreakdownRows('Sam', many(6), false);
    expect(rows).toHaveLength(BREAKDOWN_OVERFLOW_VISIBLE);
    expect(rows.map((r) => r.key)).toEqual(['g1', 'g2', 'g3', 'g4']);
    expect(hiddenCount).toBe(2);
  });

  it('the in-expansion toggle (showAll) reveals the remaining buckets', () => {
    const { rows, hiddenCount } = visibleBreakdownRows('Sam', many(6), true);
    expect(rows).toHaveLength(6);
    expect(hiddenCount).toBe(0);
  });

  it('bucket order is preserved as given (backend owns magnitude sort)', () => {
    const { rows } = visibleBreakdownRows('Sam', [bucket({ group: null }), bucket()], false);
    expect(rows.map((r) => r.direct)).toEqual([true, false]);
  });
});
