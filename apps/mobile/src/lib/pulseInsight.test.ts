import { formatMoney } from '@divzy/shared';
import { describe, expect, it } from 'vitest';
import { pulseInsight } from './pulseInsight';

// Written from spec-WI-068 §6 ("deterministic rules in priority order") and
// story-WI-068 AC-6a/AC-6e. Cross-platform copy parity (mobile vs. the web
// pulse-insight.ts, spec §6) is binding per defect-WI-068-1 (cycle 1):
// spec-named strings are verbatim; the settled+trend composition and the
// two `total === 0`-not-settled base sentences are converged byte-for-byte
// with web — see the parity fixture table at the bottom of this file.

const noUnresolved: { currency: string; amount: number }[] = [];

describe('pulseInsight', () => {
  it('(1) settled base sentence ignores total, but the append rules (3)/(4) still compose on top (spec §6 "append"; trend survives a settled ledger)', () => {
    const text = pulseInsight(
      true,
      { total: 500, currency: 'USD', unresolved: noUnresolved },
      [
        { month: '2026-01', amount: 10000 },
        { month: '2026-02', amount: 5000 },
      ],
    );
    expect(text).toBe(
      'All settled. Nothing owed in either direction. Spend ↓50% vs last month.',
    );
  });

  it('(1) settled with no spend history is the fixed settled sentence alone', () => {
    const text = pulseInsight(true, { total: 0, currency: 'USD', unresolved: noUnresolved }, []);
    expect(text).toBe('All settled. Nothing owed in either direction.');
  });

  it('(2) total > 0 — "You\'re owed {money} overall."', () => {
    const text = pulseInsight(false, { total: 128450, currency: 'USD', unresolved: noUnresolved }, []);
    expect(text).toBe(`You're owed ${formatMoney(128450, 'USD')} overall.`);
  });

  it('(2) total < 0 — "You owe {money} overall." (money uses the absolute amount)', () => {
    const text = pulseInsight(false, { total: -8620, currency: 'USD', unresolved: noUnresolved }, []);
    expect(text).toBe(`You owe ${formatMoney(8620, 'USD')} overall.`);
  });

  it('total === 0, not settled, no unresolved (coincidental cross-currency cancellation) — neutral zero base', () => {
    const text = pulseInsight(false, { total: 0, currency: 'USD', unresolved: noUnresolved }, []);
    expect(text).toBe('Your balance nets to zero overall.');
  });

  it('total === 0, not settled, unresolved present (unresolved-only state) — points at the awaiting-rate clause, never reads settled', () => {
    const text = pulseInsight(
      false,
      { total: 0, currency: 'USD', unresolved: [{ currency: 'XYZ', amount: 1200 }] },
      [],
    );
    expect(text).toBe("Some balances aren't converted yet. 1 currency awaiting a rate.");
  });

  it('(3) appends a green-down spend delta only when byMonth has >= 2 buckets and the previous month > 0', () => {
    const text = pulseInsight(false, { total: 100, currency: 'USD', unresolved: noUnresolved }, [
      { month: '2026-01', amount: 10000 },
      { month: '2026-02', amount: 8000 },
    ]);
    expect(text).toBe(`You're owed ${formatMoney(100, 'USD')} overall. Spend ↓20% vs last month.`);
  });

  it('(3) an increase appends the neutral up-arrow clause instead', () => {
    const text = pulseInsight(false, { total: 100, currency: 'USD', unresolved: noUnresolved }, [
      { month: '2026-01', amount: 8000 },
      { month: '2026-02', amount: 10000 },
    ]);
    expect(text).toBe(`You're owed ${formatMoney(100, 'USD')} overall. Spend ↑25% vs last month.`);
  });

  it('(3) omits the clause entirely with fewer than 2 buckets', () => {
    const text = pulseInsight(false, { total: 100, currency: 'USD', unresolved: noUnresolved }, [
      { month: '2026-02', amount: 8000 },
    ]);
    expect(text).toBe(`You're owed ${formatMoney(100, 'USD')} overall.`);
  });

  it('(3) omits the clause when the previous month was 0 (no meaningful percentage)', () => {
    const text = pulseInsight(false, { total: 100, currency: 'USD', unresolved: noUnresolved }, [
      { month: '2026-01', amount: 0 },
      { month: '2026-02', amount: 8000 },
    ]);
    expect(text).toBe(`You're owed ${formatMoney(100, 'USD')} overall.`);
  });

  it('(3) omits the clause when the percentage change rounds to exactly 0', () => {
    const text = pulseInsight(false, { total: 100, currency: 'USD', unresolved: noUnresolved }, [
      { month: '2026-01', amount: 8000 },
      { month: '2026-02', amount: 8000 },
    ]);
    expect(text).toBe(`You're owed ${formatMoney(100, 'USD')} overall.`);
  });

  it('(3) omits the clause when a sub-half-percent delta rounds to 0 (8000 → 7995)', () => {
    const text = pulseInsight(false, { total: 100, currency: 'USD', unresolved: noUnresolved }, [
      { month: '2026-01', amount: 8000 },
      { month: '2026-02', amount: 7995 },
    ]);
    expect(text).toBe(`You're owed ${formatMoney(100, 'USD')} overall.`);
  });

  it('(3) rounds a half-percent DROP up to ↓1% — magnitude rounding, symmetric with a half-percent rise (defect-WI-068-1 parity)', () => {
    const text = pulseInsight(false, { total: 100, currency: 'USD', unresolved: noUnresolved }, [
      { month: '2026-01', amount: 8000 },
      { month: '2026-02', amount: 7960 },
    ]);
    expect(text).toBe(`You're owed ${formatMoney(100, 'USD')} overall. Spend ↓1% vs last month.`);
  });

  it('(4) appends a singular unresolved-currency note', () => {
    const text = pulseInsight(
      false,
      { total: 100, currency: 'USD', unresolved: [{ currency: 'EUR', amount: 500 }] },
      [],
    );
    expect(text).toBe(`You're owed ${formatMoney(100, 'USD')} overall. 1 currency awaiting a rate.`);
  });

  it('(4) pluralizes for more than one unresolved currency', () => {
    const text = pulseInsight(
      false,
      {
        total: 100,
        currency: 'USD',
        unresolved: [
          { currency: 'EUR', amount: 500 },
          { currency: 'JPY', amount: 1000 },
        ],
      },
      [],
    );
    expect(text).toBe(`You're owed ${formatMoney(100, 'USD')} overall. 2 currencies awaiting a rate.`);
  });

  it('combines the base sentence, spend delta, and unresolved note in priority order', () => {
    const text = pulseInsight(
      false,
      { total: -8620, currency: 'USD', unresolved: [{ currency: 'EUR', amount: 500 }] },
      [
        { month: '2026-01', amount: 10000 },
        { month: '2026-02', amount: 8000 },
      ],
    );
    expect(text).toBe(
      `You owe ${formatMoney(8620, 'USD')} overall. Spend ↓20% vs last month. 1 currency awaiting a rate.`,
    );
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
      const text = pulseInsight(
        fixture.settled,
        {
          total: fixture.total,
          currency: 'USD',
          unresolved: PARITY_UNRESOLVED.slice(0, fixture.unresolvedCount),
        },
        fixture.byMonth.map((amount, i) => ({
          month: i === 0 ? '2026-06' : '2026-07',
          amount,
        })),
      );
      expect(text).toBe(fixture.expected);
    });
  }
});
