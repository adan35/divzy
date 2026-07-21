import { describe, expect, it } from 'vitest';
import type { GroupSummaryDto } from '@divzy/shared';
import { applyGroupFilters, groupsFilterEmptyMessage, splitArchived } from './groupsListFilter';

// Tests written from spec-WI-028 (settled + "unsettled only" toggle) and
// spec-WI-038 (balance-direction filter) before groupsListFilter.ts exists.
// Pins: (1) the two filters are independent AND conditions — never merged
// into one concept (WI-038 D2's explicit warning); (2) both compose
// independently of the archived/active split (WI-038 UI note); (3) filtering
// runs over the NATIVE `yourBalancesNative` field, never a converted figure
// (ARCH invariant 5, restated by both specs).

function group(overrides: Partial<GroupSummaryDto> = {}): GroupSummaryDto {
  return {
    id: 'g1',
    name: 'Trip',
    emoji: '✈️',
    type: 'TRIP',
    currency: 'USD',
    memberCount: 3,
    yourBalances: [],
    yourBalancesNative: [],
    yourBalanceConverted: null,
    usedFallbackRates: false,
    lastActivityAt: '2026-07-01T00:00:00.000Z',
    archivedAt: null,
    settled: true,
    ...overrides,
  };
}

describe('applyGroupFilters', () => {
  it('passes everything through with defaults (unsettledOnly off, filter none)', () => {
    const groups = [group({ id: 'a' }), group({ id: 'b', settled: false })];
    expect(applyGroupFilters(groups, { unsettledOnly: false, balanceFilter: 'none' })).toEqual(
      groups,
    );
  });

  it('unsettledOnly hides group-wide settled groups', () => {
    const settled = group({ id: 'a', settled: true });
    const unsettled = group({ id: 'b', settled: false });
    const result = applyGroupFilters([settled, unsettled], {
      unsettledOnly: true,
      balanceFilter: 'none',
    });
    expect(result).toEqual([unsettled]);
  });

  it('balance filter "youOwe" matches only groups with a negative native net', () => {
    const owe = group({ id: 'a', yourBalancesNative: [{ currency: 'USD', amount: -500 }] });
    const owed = group({ id: 'b', yourBalancesNative: [{ currency: 'USD', amount: 500 }] });
    const result = applyGroupFilters([owe, owed], { unsettledOnly: false, balanceFilter: 'youOwe' });
    expect(result).toEqual([owe]);
  });

  it('balance filter "owedYou" matches only groups with a positive native net', () => {
    const owe = group({ id: 'a', yourBalancesNative: [{ currency: 'USD', amount: -500 }] });
    const owed = group({ id: 'b', yourBalancesNative: [{ currency: 'USD', amount: 500 }] });
    const result = applyGroupFilters([owe, owed], {
      unsettledOnly: false,
      balanceFilter: 'owedYou',
    });
    expect(result).toEqual([owed]);
  });

  it('a mixed-currency group matches both youOwe and owedYou (never dropped from either)', () => {
    const mixed = group({
      id: 'a',
      yourBalancesNative: [
        { currency: 'USD', amount: -500 },
        { currency: 'EUR', amount: 300 },
      ],
    });
    expect(
      applyGroupFilters([mixed], { unsettledOnly: false, balanceFilter: 'youOwe' }),
    ).toEqual([mixed]);
    expect(
      applyGroupFilters([mixed], { unsettledOnly: false, balanceFilter: 'owedYou' }),
    ).toEqual([mixed]);
  });

  it('settled and balance-filter axes are independent (viewer-settled but group-unsettled composes correctly)', () => {
    // Viewer's own net is zero (would fail a "youOwe"/"owedYou" filter) but
    // the group is NOT group-wide settled (another member has a nonzero net)
    // — the two questions are different and must not be conflated.
    const viewerSettledGroupUnsettled = group({ id: 'a', settled: false, yourBalancesNative: [] });
    expect(
      applyGroupFilters([viewerSettledGroupUnsettled], {
        unsettledOnly: true,
        balanceFilter: 'none',
      }),
    ).toEqual([viewerSettledGroupUnsettled]);
    expect(
      applyGroupFilters([viewerSettledGroupUnsettled], {
        unsettledOnly: false,
        balanceFilter: 'outstanding',
      }),
    ).toEqual([]);
  });

  it('composes independently of the archived/active split — filters apply within both sections', () => {
    const archived = group({ id: 'a', archivedAt: '2026-07-01T00:00:00.000Z', settled: false });
    const active = group({ id: 'b', settled: false });
    const result = applyGroupFilters([archived, active], {
      unsettledOnly: true,
      balanceFilter: 'none',
    });
    expect(result).toEqual([archived, active]);
  });
});

describe('splitArchived', () => {
  it('splits into active (archivedAt null) and archived (non-null), most-recent first', () => {
    const a = group({ id: 'a', archivedAt: null, lastActivityAt: '2026-07-01T00:00:00.000Z' });
    const b = group({ id: 'b', archivedAt: null, lastActivityAt: '2026-07-10T00:00:00.000Z' });
    const c = group({ id: 'c', archivedAt: '2026-06-01T00:00:00.000Z' });
    const d = group({ id: 'd', archivedAt: '2026-06-15T00:00:00.000Z' });
    const { active, archived } = splitArchived([a, b, c, d]);
    expect(active.map((g) => g.id)).toEqual(['b', 'a']);
    expect(archived.map((g) => g.id)).toEqual(['d', 'c']);
  });
});

describe('groupsFilterEmptyMessage', () => {
  it('describes the balance filter when active', () => {
    expect(groupsFilterEmptyMessage('youOwe', false)).toMatch(/owe/i);
    expect(groupsFilterEmptyMessage('owedYou', false)).toMatch(/owed/i);
    expect(groupsFilterEmptyMessage('outstanding', false)).toMatch(/outstanding/i);
  });

  it('describes the unsettled-only toggle when active and no directional filter', () => {
    expect(groupsFilterEmptyMessage('none', true)).toMatch(/unsettled/i);
  });

  it('falls back to a generic message with no filters active', () => {
    expect(groupsFilterEmptyMessage('none', false)).toBeTruthy();
  });
});
