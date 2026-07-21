import { describe, expect, it } from 'vitest';
import { EXPENSE_CATEGORIES } from '@divzy/shared';
import { categoryPickerGrid } from './categoryPickerNarrowing';

// Tests written from spec-WI-032-3 §1 D4-D8 / §3 / §6 before
// categoryPickerGrid exists.

const usedTwo = ['FOOD_DRINK', 'TRANSPORT'] as const;

describe('categoryPickerGrid', () => {
  it('Sc.1 — narrows to only the used categories (plus current value) when groupId is set', () => {
    const { cells, showFull } = categoryPickerGrid({
      groupId: 'g1',
      value: 'FOOD_DRINK',
      showAll: false,
      usedCategories: [...usedTwo],
      isLoading: false,
      isError: false,
    });
    expect(showFull).toBe(false);
    expect(cells.map((c) => c.key)).toEqual(['FOOD_DRINK', 'TRANSPORT']);
  });

  it('Sc.2/D5 — always unions in the current value, even if not in the used set', () => {
    const { cells } = categoryPickerGrid({
      groupId: 'g1',
      value: 'PETS',
      showAll: false,
      usedCategories: [...usedTwo],
      isLoading: false,
      isError: false,
    });
    expect(cells.map((c) => c.key)).toEqual(['FOOD_DRINK', 'TRANSPORT', 'PETS']);
  });

  it('D8 — narrowed cells preserve the canonical EXPENSE_CATEGORIES order, not usedCategories order', () => {
    const { cells } = categoryPickerGrid({
      groupId: 'g1',
      value: 'GENERAL',
      showAll: false,
      usedCategories: ['PETS', 'FOOD_DRINK'],
      isLoading: false,
      isError: false,
    });
    expect(cells.map((c) => c.key)).toEqual(['FOOD_DRINK', 'PETS', 'GENERAL']);
  });

  it('Sc.3 — showAll reveals the full 16-grid', () => {
    const { cells, showFull } = categoryPickerGrid({
      groupId: 'g1',
      value: 'FOOD_DRINK',
      showAll: true,
      usedCategories: [...usedTwo],
      isLoading: false,
      isError: false,
    });
    expect(showFull).toBe(true);
    expect(cells).toHaveLength(EXPENSE_CATEGORIES.length);
  });

  it('Sc.6/D6 — an empty used set (brand-new group) falls back to the full grid, not an empty one', () => {
    const { cells, showFull } = categoryPickerGrid({
      groupId: 'g1',
      value: 'GENERAL',
      showAll: false,
      usedCategories: [],
      isLoading: false,
      isError: false,
    });
    expect(showFull).toBe(true);
    expect(cells).toHaveLength(EXPENSE_CATEGORIES.length);
  });

  it('Sc.9 — loading falls back to the full grid', () => {
    const { showFull } = categoryPickerGrid({
      groupId: 'g1',
      value: 'GENERAL',
      showAll: false,
      usedCategories: undefined,
      isLoading: true,
      isError: false,
    });
    expect(showFull).toBe(true);
  });

  it('Sc.9 — error falls back to the full grid', () => {
    const { showFull } = categoryPickerGrid({
      groupId: 'g1',
      value: 'GENERAL',
      showAll: false,
      usedCategories: undefined,
      isLoading: false,
      isError: true,
    });
    expect(showFull).toBe(true);
  });

  it('Sc.7 — non-group (no groupId) never narrows', () => {
    const { showFull } = categoryPickerGrid({
      groupId: undefined,
      value: 'GENERAL',
      showAll: false,
      usedCategories: undefined,
      isLoading: false,
      isError: false,
    });
    expect(showFull).toBe(true);
  });

  it('Sc.8 — editing includes the current category even if it fell out of the used set (server already excludes soft-deleted)', () => {
    const { cells } = categoryPickerGrid({
      groupId: 'g1',
      value: 'SUBSCRIPTIONS',
      showAll: false,
      usedCategories: ['FOOD_DRINK'],
      isLoading: false,
      isError: false,
    });
    expect(cells.map((c) => c.key)).toContain('SUBSCRIPTIONS');
  });
});
