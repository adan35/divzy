import { describe, expect, it } from 'vitest';
import { foldGroupSpend, groupSpendBars, isGroupSpendEmpty } from './groupSpendChart';

// Tests written from spec-WI-060 §2 Mobile component and §4 Empty-state
// design before groupSpendBars/isGroupSpendEmpty exist.

describe('isGroupSpendEmpty', () => {
  it('is false when byGroup is undefined (still loading)', () => {
    expect(isGroupSpendEmpty(undefined)).toBe(false);
  });

  it('is true when byGroup is an empty array (server already zero-filters)', () => {
    expect(isGroupSpendEmpty([])).toBe(true);
  });

  it('is false when byGroup has at least one entry', () => {
    expect(
      isGroupSpendEmpty([{ groupId: 'g1', name: 'Trip', emoji: '✈️', amount: 500 }]),
    ).toBe(false);
  });
});

describe('groupSpendBars', () => {
  it('returns an empty array for an empty byGroup', () => {
    expect(groupSpendBars([], 100)).toEqual([]);
  });

  it('scales each bar height proportionally to the max amount', () => {
    const bars = groupSpendBars(
      [
        { groupId: 'g1', name: 'Trip', emoji: '✈️', amount: 1000 },
        { groupId: 'g2', name: 'House', emoji: '🏠', amount: 500 },
        { groupId: 'g3', name: 'Work', emoji: '💼', amount: 250 },
      ],
      100,
    );
    expect(bars[0]).toMatchObject({ groupId: 'g1', height: 100, isHighlight: true });
    expect(bars[1]).toMatchObject({ groupId: 'g2', height: 50, isHighlight: false });
    expect(bars[2]).toMatchObject({ groupId: 'g3', height: 25, isHighlight: false });
  });

  it('marks only index 0 as the highlight, trusting the already amount-desc-sorted input verbatim', () => {
    const bars = groupSpendBars(
      [
        { groupId: 'g1', name: 'Trip', emoji: '✈️', amount: 300 },
        { groupId: 'g2', name: 'House', emoji: '🏠', amount: 300 },
      ],
      100,
    );
    expect(bars[0]!.isHighlight).toBe(true);
    expect(bars[1]!.isHighlight).toBe(false);
  });

  it('floors zero-amount bars to a minimal 2px sliver rather than 0', () => {
    const bars = groupSpendBars(
      [
        { groupId: 'g1', name: 'Trip', amount: 100, emoji: '✈️' },
        { groupId: 'g2', name: 'Zero', amount: 0, emoji: '🚫' },
      ],
      100,
    );
    expect(bars[1]!.height).toBe(2);
  });

  it('gives every bar a minimum 4px height even when negligibly small relative to the max', () => {
    const bars = groupSpendBars(
      [
        { groupId: 'g1', name: 'Trip', amount: 100_000, emoji: '✈️' },
        { groupId: 'g2', name: 'Tiny', amount: 1, emoji: '🐜' },
      ],
      100,
    );
    expect(bars[1]!.height).toBeGreaterThanOrEqual(4);
  });

  it('when the max amount is 0 (should not normally happen post empty-filter), still returns a 2px sliver, not NaN', () => {
    const bars = groupSpendBars(
      [{ groupId: 'g1', name: 'Trip', amount: 0, emoji: '✈️' }],
      100,
    );
    expect(bars[0]!.height).toBe(2);
  });

  it('folds >8 groups into a single "Other" bar, preserving the top bar\'s highlight', () => {
    // g0 is a clear outlier so it stays the tallest bar even after the
    // folded tail (g7..g9) is summed into "Other".
    const many = Array.from({ length: 10 }, (_, i) => ({
      groupId: `g${i}`,
      name: `Group ${i}`,
      emoji: '🏠',
      amount: i === 0 ? 1000 : 10 - i,
    }));

    const bars = groupSpendBars(many, 100);

    // 8-1 kept ranked bars + 1 "Other" bar = 8 total.
    expect(bars).toHaveLength(8);
    expect(bars[0]).toMatchObject({ groupId: 'g0', isHighlight: true, height: 100 });
    expect(bars.at(-1)).toMatchObject({ groupId: '__other__', name: 'Other', isHighlight: false });
    // Other bar sums the folded tail (g7..g9): 3 + 2 + 1.
    expect(bars.at(-1)!.amount).toBe(3 + 2 + 1);
  });

  it('does not fold exactly 8 groups', () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({
      groupId: `g${i}`,
      name: `Group ${i}`,
      emoji: '🏠',
      amount: 1000 - i,
    }));
    const bars = groupSpendBars(eight, 100);
    expect(bars).toHaveLength(8);
    expect(bars.some((b) => b.groupId === '__other__')).toBe(false);
  });
});

describe('foldGroupSpend', () => {
  it('returns input verbatim when at or below the 8-group max', () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({
      groupId: `g${i}`,
      name: `Group ${i}`,
      emoji: '🏠',
      amount: 1000 - i,
    }));
    expect(foldGroupSpend(eight)).toEqual(eight);
  });

  it('folds the tail past the top 7 into a single "Other" entry, never folding away index 0', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      groupId: `g${i}`,
      name: `Group ${i}`,
      emoji: '🏠',
      amount: 900 - i * 10,
    }));

    const folded = foldGroupSpend(many);

    expect(folded).toHaveLength(8);
    expect(folded.slice(0, 7).map((g) => g.groupId)).toEqual([
      'g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6',
    ]);
    const other = folded.at(-1)!;
    expect(other.groupId).toBe('__other__');
    expect(other.name).toBe('Other');
    // Folded tail is g7, g8: (900-70)+(900-80).
    expect(other.amount).toBe(830 + 820);
  });

  it('an empty array is unaffected', () => {
    expect(foldGroupSpend([])).toEqual([]);
  });
});
