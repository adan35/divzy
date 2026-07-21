// Test-stage coverage for WI-060 — pure data-shaping backing the web
// `GroupSpendChart`. Extracted from group-spend-chart.tsx because recharts'
// `ResponsiveContainer` renders zero-size (and therefore zero `<Cell>`
// output) under jsdom — empirically confirmed while building this suite —
// so the highlight/fold/empty branching cannot be asserted via a rendered
// DOM test the way the component's loading/error/empty *states* can. See
// group-spend-chart.test.tsx for the render-level coverage of those states.
import { describe, expect, it } from 'vitest';
import {
  buildGroupSpendChartRows,
  groupSpendBarFill,
  isGroupSpendEmpty,
  type GroupSpendEntry,
} from './group-spend-chart-data';

function entry(overrides: Partial<GroupSpendEntry> = {}): GroupSpendEntry {
  return {
    groupId: 'g1',
    name: 'Trip',
    emoji: '✈️',
    amount: 1000,
    ...overrides,
  };
}

describe('buildGroupSpendChartRows', () => {
  it('empty input yields an empty row list', () => {
    expect(buildGroupSpendChartRows([])).toEqual([]);
  });

  it('flags only the first entry as the highlight, even when a later entry ties its amount', () => {
    const rows = buildGroupSpendChartRows([
      entry({ groupId: 'g1', name: 'Trip', amount: 5000 }),
      entry({ groupId: 'g2', name: 'House', amount: 5000 }),
      entry({ groupId: 'g3', name: 'Roomies', amount: 1000 }),
    ]);

    expect(rows.map((r) => r.isHighlight)).toEqual([true, false, false]);
    expect(rows[0].key).toBe('g1');
  });

  it('consumes byGroup verbatim — no re-sort by amount (server already sorts)', () => {
    // Deliberately out-of-amount-order input (server contract says it never
    // happens, but the function must not silently "fix" it) — the function
    // must not reorder; index 0 stays the highlight regardless of amount.
    const rows = buildGroupSpendChartRows([
      entry({ groupId: 'g1', name: 'Small', amount: 100 }),
      entry({ groupId: 'g2', name: 'Big', amount: 9000 }),
    ]);

    expect(rows.map((r) => r.key)).toEqual(['g1', 'g2']);
    expect(rows[0].isHighlight).toBe(true);
    expect(rows[1].isHighlight).toBe(false);
  });

  it('joins emoji and name into the label, preserving amount and key verbatim (no currency conversion)', () => {
    const rows = buildGroupSpendChartRows([entry({ groupId: 'g7', name: 'Ski trip', emoji: '🎿', amount: 12345 })]);

    expect(rows).toEqual([
      { key: 'g7', label: 'Ski trip', emoji: '🎿', amount: 12345, isHighlight: true },
    ]);
  });

  it('folds beyond 8 groups into an "Other" bucket, never folding away the highlighted top entry', () => {
    const many: GroupSpendEntry[] = Array.from({ length: 10 }, (_, i) =>
      entry({ groupId: `g${i}`, name: `Group ${i}`, amount: 1000 - i * 10 }),
    );

    const rows = buildGroupSpendChartRows(many);

    // 8-1 kept ranked rows + 1 "Other" bucket = 8 total.
    expect(rows).toHaveLength(8);
    expect(rows[0].key).toBe('g0');
    expect(rows[0].isHighlight).toBe(true);
    expect(rows.at(-1)?.key).toBe('__other__');
    expect(rows.at(-1)?.isHighlight).toBe(false);
    // Other bucket sums the folded tail (g7..g9): (1000-70)+(1000-80)+(1000-90).
    expect(rows.at(-1)?.amount).toBe(930 + 920 + 910);
  });

  it('8 or fewer groups are not folded at all', () => {
    const eight: GroupSpendEntry[] = Array.from({ length: 8 }, (_, i) =>
      entry({ groupId: `g${i}`, amount: 1000 - i }),
    );
    const rows = buildGroupSpendChartRows(eight);
    expect(rows).toHaveLength(8);
    expect(rows.some((r) => r.key === '__other__')).toBe(false);
  });
});

describe('groupSpendBarFill (spec-WI-068 §8.2 — single-series marks use chart-1, not brand)', () => {
  it('the highlighted (top-spend) bar resolves to the chart-1 token, never brand', () => {
    expect(groupSpendBarFill(true)).toBe('var(--chart-1)');
  });

  it('every other bar stays the muted surface-2 wash', () => {
    expect(groupSpendBarFill(false)).toBe('var(--surface-2)');
  });
});

describe('isGroupSpendEmpty', () => {
  it('undefined (still loading/error) is never treated as empty', () => {
    expect(isGroupSpendEmpty(undefined)).toBe(false);
  });

  it('an empty array is the "no group spend yet" empty state', () => {
    expect(isGroupSpendEmpty([])).toBe(true);
  });

  it('a non-empty array is not empty', () => {
    expect(isGroupSpendEmpty([entry()])).toBe(false);
  });
});
