// WI-068 S2 (Web money moments) — spec §6 / story AC-6a: the Divzy Pulse
// insight line is a PURE, deterministic rule table over the existing
// `GET /balance` + `GET /analytics/summary` DTOs (no new endpoint, no
// client-side currency conversion). Priority order:
//   1. settled (native totals/youOwe/youAreOwed all empty — the WI-001 guard,
//      NEVER `converted.total === 0`, which an unresolved-only balance can
//      also reach)
//   2. total > 0 / total < 0 sentence
//   3. append a spend-trend clause (byMonth >= 2 buckets, previous month > 0)
//   4. append an unresolved-currencies clause
import { describe, expect, it } from 'vitest';
import type { AnalyticsSummaryDto, OverallBalanceDto } from '@divzy/shared';
import { pulseInsight } from './pulse-insight';

type Balance = Pick<OverallBalanceDto, 'totals' | 'youOwe' | 'youAreOwed' | 'converted'>;
type Bucket = AnalyticsSummaryDto['byMonth'][number];

function bucket(month: string, amount: number): Bucket {
  return { month, amount, totalActivity: amount };
}

function balance(overrides: Partial<Balance['converted']> & { settled?: boolean } = {}): Balance {
  const { settled, ...convertedOverrides } = overrides;
  return {
    totals: settled ? [] : [{ currency: 'USD', amount: 1 }],
    youOwe: settled ? [] : [{ currency: 'USD', amount: 0 }],
    youAreOwed: settled ? [] : [],
    converted: {
      currency: 'USD',
      total: 0,
      youOwe: 0,
      youAreOwed: 0,
      unresolved: [],
      usedFallbackRates: false,
      ...convertedOverrides,
    },
  };
}

describe('pulseInsight — rule 1 (settled)', () => {
  it('renders the settled sentence when native totals/youOwe/youAreOwed are all empty', () => {
    const result = pulseInsight(
      { totals: [], youOwe: [], youAreOwed: [], converted: balance().converted },
      [],
    );
    expect(result.base).toBe('All settled. Nothing owed in either direction.');
    expect(result.unresolved).toBeNull();
  });

  it('WI-001 guard: converted.total === 0 with non-empty native totals is NOT settled', () => {
    // e.g. two currencies that happen to cancel out after conversion —
    // native per-currency debts still exist, so this must not read settled.
    const result = pulseInsight(
      {
        totals: [{ currency: 'USD', amount: -500 }, { currency: 'EUR', amount: 613 }],
        youOwe: [{ currency: 'USD', amount: 500 }],
        youAreOwed: [{ currency: 'EUR', amount: 613 }],
        converted: { currency: 'GBP', total: 0, youOwe: 0, youAreOwed: 0, unresolved: [], usedFallbackRates: false },
      },
      [],
    );
    expect(result.base).not.toContain('All settled');
  });

  it('settled with spend data still appends the spend clause (trend survives a settled ledger)', () => {
    const result = pulseInsight(
      { totals: [], youOwe: [], youAreOwed: [], converted: balance().converted },
      [bucket('2026-05', 5000), bucket('2026-06', 4000)],
    );
    expect(result.base).toBe('All settled. Nothing owed in either direction.');
    expect(result.spend).toEqual({ text: 'Spend ↓20% vs last month.', tone: 'pos' });
  });
});

describe('pulseInsight — rule 2 (total sign)', () => {
  it('total > 0 -> "You\'re owed {money} overall."', () => {
    const result = pulseInsight(balance({ total: 128450, currency: 'USD' }), []);
    expect(result.base).toBe("You're owed $1,284.50 overall.");
  });

  it('total < 0 -> "You owe {money} overall." (money is the absolute magnitude)', () => {
    const result = pulseInsight(balance({ total: -8620, currency: 'USD' }), []);
    expect(result.base).toBe('You owe $86.20 overall.');
  });

  it('formats using whatever converted.currency the response carries, never a hardcoded symbol', () => {
    // JPY has 0 minor-unit decimals — 5000 minor units is ¥5,000, not $50.00.
    const result = pulseInsight(balance({ total: 5000, currency: 'JPY' }), []);
    expect(result.base).toBe("You're owed ¥5,000 overall.");
  });

  it('total === 0, not settled, unresolved present (unresolved-only state) -> neutral zero base, no false settled claim', () => {
    const result = pulseInsight(
      balance({ total: 0, unresolved: [{ currency: 'XYZ', amount: 1200 }] }),
      [],
    );
    expect(result.base).not.toContain('All settled');
    expect(result.base).toBe("Some balances aren't converted yet.");
  });

  it('total === 0, not settled, no unresolved (coincidental cross-currency cancellation) -> neutral zero base', () => {
    const result = pulseInsight(balance({ total: 0 }), []);
    expect(result.base).toBe('Your balance nets to zero overall.');
  });
});

describe('pulseInsight — rule 3 (spend-trend clause)', () => {
  it('is absent with fewer than 2 monthly buckets', () => {
    const result = pulseInsight(balance({ total: 100 }), [bucket('2026-07', 1000)]);
    expect(result.spend).toBeNull();
  });

  it('is absent when the previous month is 0 (no baseline to compute a percentage from)', () => {
    const result = pulseInsight(balance({ total: 100 }), [bucket('2026-06', 0), bucket('2026-07', 1000)]);
    expect(result.spend).toBeNull();
  });

  it('is absent when the previous month is negative (defensive — should never occur, but no baseline either way)', () => {
    const result = pulseInsight(balance({ total: 100 }), [bucket('2026-06', -100), bucket('2026-07', 1000)]);
    expect(result.spend).toBeNull();
  });

  it('spend down -> green/pos tone with the down arrow and a positive percent', () => {
    const result = pulseInsight(balance({ total: 100 }), [bucket('2026-06', 5000), bucket('2026-07', 4000)]);
    expect(result.spend).toEqual({ text: 'Spend ↓20% vs last month.', tone: 'pos' });
  });

  it('spend up -> neutral ink-2 tone with the up arrow, never red/neg', () => {
    const result = pulseInsight(balance({ total: 100 }), [bucket('2026-06', 4000), bucket('2026-07', 5000)]);
    expect(result.spend).toEqual({ text: 'Spend ↑25% vs last month.', tone: 'neutral' });
  });

  it('is absent when spend is unchanged (flat trend has no meaningful delta to report)', () => {
    const result = pulseInsight(balance({ total: 100 }), [bucket('2026-06', 3000), bucket('2026-07', 3000)]);
    expect(result.spend).toBeNull();
  });

  it('only compares the last two buckets, ignoring earlier months', () => {
    const result = pulseInsight(balance({ total: 100 }), [
      bucket('2026-04', 100),
      bucket('2026-05', 100000),
      bucket('2026-06', 5000),
      bucket('2026-07', 4000),
    ]);
    expect(result.spend).toEqual({ text: 'Spend ↓20% vs last month.', tone: 'pos' });
  });

  it('rounds the percentage to the nearest whole number', () => {
    const result = pulseInsight(balance({ total: 100 }), [bucket('2026-06', 3000), bucket('2026-07', 2000)]);
    // (3000-2000)/3000 = 33.33...% -> rounds to 33%.
    expect(result.spend).toEqual({ text: 'Spend ↓33% vs last month.', tone: 'pos' });
  });

  it('is absent when a sub-half-percent delta rounds to 0% (8000 → 7995 — "Spend ↓0%" is not a clause; defect-WI-068-1 parity)', () => {
    const result = pulseInsight(balance({ total: 100 }), [bucket('2026-06', 8000), bucket('2026-07', 7995)]);
    expect(result.spend).toBeNull();
  });

  it('rounds a half-percent DROP up to ↓1% — magnitude rounding, symmetric with a half-percent rise (defect-WI-068-1 parity)', () => {
    const result = pulseInsight(balance({ total: 100 }), [bucket('2026-06', 8000), bucket('2026-07', 7960)]);
    expect(result.spend).toEqual({ text: 'Spend ↓1% vs last month.', tone: 'pos' });
  });
});

describe('pulseInsight — rule 4 (unresolved clause)', () => {
  it('is null when there is nothing unresolved', () => {
    const result = pulseInsight(balance({ total: 100 }), []);
    expect(result.unresolved).toBeNull();
  });

  it('singular wording for exactly one unresolved currency', () => {
    const result = pulseInsight(
      balance({ total: 0, unresolved: [{ currency: 'XYZ', amount: 1200 }] }),
      [],
    );
    expect(result.unresolved).toBe('1 currency awaiting a rate.');
  });

  it('plural wording for 2+ unresolved currencies', () => {
    const result = pulseInsight(
      balance({
        total: 0,
        unresolved: [
          { currency: 'XYZ', amount: 1200 },
          { currency: 'ABC', amount: 300 },
        ],
      }),
      [],
    );
    expect(result.unresolved).toBe('2 currencies awaiting a rate.');
  });

  it('combines with rule 2 and rule 3 simultaneously (all three clauses present)', () => {
    const result = pulseInsight(
      balance({ total: 128450, currency: 'USD', unresolved: [{ currency: 'XYZ', amount: 1200 }] }),
      [bucket('2026-06', 5000), bucket('2026-07', 4000)],
    );
    expect(result.base).toBe("You're owed $1,284.50 overall.");
    expect(result.spend).toEqual({ text: 'Spend ↓20% vs last month.', tone: 'pos' });
    expect(result.unresolved).toBe('1 currency awaiting a rate.');
  });
});

// ---------------------------------------------------------------------------
// Cross-platform parity fixture table (defect-WI-068-1, test-plan-WI-068 §4).
// This table is duplicated byte-for-byte in BOTH platforms' pulseInsight test
// files (web: src/components/dashboard/pulse-insight.test.ts, mobile:
// src/lib/pulseInsight.test.ts — the two workspaces cannot share an import).
// Identical inputs MUST produce byte-identical composed output; update both
// copies together.
const PARITY_UNRESOLVED = [
  { currency: 'XYZ', amount: 1200 },
  { currency: 'ABC', amount: 300 },
];

const PARITY_FIXTURES = [
  {
    name: 'F1 total>0, no trend, no unresolved',
    settled: false,
    total: 128450,
    byMonth: [] as number[],
    unresolvedCount: 0,
    expected: "You're owed $1,284.50 overall.",
  },
  {
    name: 'F2 total<0',
    settled: false,
    total: -8620,
    byMonth: [] as number[],
    unresolvedCount: 0,
    expected: 'You owe $86.20 overall.',
  },
  {
    name: 'F3 settled + meaningful spend trend',
    settled: true,
    total: 0,
    byMonth: [5000, 4000],
    unresolvedCount: 0,
    expected: 'All settled. Nothing owed in either direction. Spend ↓20% vs last month.',
  },
  {
    name: 'F4 total===0, not settled, unresolved present',
    settled: false,
    total: 0,
    byMonth: [] as number[],
    unresolvedCount: 1,
    expected: "Some balances aren't converted yet. 1 currency awaiting a rate.",
  },
  {
    name: 'F5 total===0, not settled, no unresolved (coincidental cancellation)',
    settled: false,
    total: 0,
    byMonth: [] as number[],
    unresolvedCount: 0,
    expected: 'Your balance nets to zero overall.',
  },
  {
    name: 'F6 spend up (neutral), no unresolved',
    settled: false,
    total: 100,
    byMonth: [4000, 5000],
    unresolvedCount: 0,
    expected: "You're owed $1.00 overall. Spend ↑25% vs last month.",
  },
  {
    name: 'F7 total>0 + spend down + unresolved singular',
    settled: false,
    total: 128450,
    byMonth: [5000, 4000],
    unresolvedCount: 1,
    expected: "You're owed $1,284.50 overall. Spend ↓20% vs last month. 1 currency awaiting a rate.",
  },
];

describe('pulseInsight — cross-platform parity fixture table (defect-WI-068-1)', () => {
  for (const fixture of PARITY_FIXTURES) {
    it(fixture.name, () => {
      const result = pulseInsight(
        balance({
          settled: fixture.settled,
          total: fixture.total,
          currency: 'USD',
          unresolved: PARITY_UNRESOLVED.slice(0, fixture.unresolvedCount),
        }),
        fixture.byMonth.map((amount, i) => bucket(i === 0 ? '2026-06' : '2026-07', amount)),
      );
      // Composed exactly the way pulse-hero.tsx renders the line:
      // base + (spend ? ' ' + spend.text : '') + (unresolved ? ' ' + unresolved : '').
      const composed = [result.base, result.spend?.text ?? null, result.unresolved]
        .filter((part): part is string => part !== null)
        .join(' ');
      expect(composed).toBe(fixture.expected);
    });
  }
});
