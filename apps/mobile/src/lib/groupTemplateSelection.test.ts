import { describe, expect, it } from 'vitest';
import {
  applyTypeChangeToTemplate,
  initialTemplateState,
  toggleCategorySelection,
} from './groupTemplateSelection';

// Tests written from spec-WI-020's Decisions § D3/D4 and the "Mobile —
// create-form wiring" sequence flow, before groupTemplateSelection.ts
// exists — pins the per-field touched/untouched merge rule that
// apps/mobile/app/group-form.tsx's selectType() delegates to, mirroring
// web's handleTypeChange (group-form-dialog.tsx).

describe('initialTemplateState', () => {
  it('seeds categories + split mode from a curated type', () => {
    expect(initialTemplateState('ROOMMATES')).toEqual({
      categoryOptions: ['RENT', 'UTILITIES', 'GROCERIES', 'HOME'],
      selectedCategories: ['RENT', 'UTILITIES', 'GROCERIES', 'HOME'],
      splitType: 'EQUAL',
    });
  });

  it('is empty/undefined for a type with no curated template (graceful degradation)', () => {
    expect(initialTemplateState('OTHER')).toEqual({
      categoryOptions: [],
      selectedCategories: [],
      splitType: undefined,
    });
  });
});

describe('applyTypeChangeToTemplate', () => {
  const untouched = {
    categoryOptions: ['TRAVEL', 'FOOD_DRINK', 'TRANSPORT', 'ENTERTAINMENT'] as const,
    selectedCategories: ['TRAVEL', 'FOOD_DRINK', 'TRANSPORT', 'ENTERTAINMENT'] as const,
    splitType: 'EQUAL' as const,
    categoriesTouched: false,
    splitTypeTouched: false,
  };

  it('refreshes both untouched fields to the new type template on type switch', () => {
    // TRIP -> ROOMMATES, nothing touched yet
    const next = applyTypeChangeToTemplate(untouched, 'ROOMMATES');
    expect(next).toEqual({
      categoryOptions: ['RENT', 'UTILITIES', 'GROCERIES', 'HOME'],
      selectedCategories: ['RENT', 'UTILITIES', 'GROCERIES', 'HOME'],
      splitType: 'EQUAL',
    });
  });

  it('preserves a touched category override while the untouched split mode still refreshes', () => {
    const prev = {
      categoryOptions: ['TRAVEL', 'FOOD_DRINK', 'TRANSPORT'] as const, // user deselected ENTERTAINMENT
      selectedCategories: ['TRAVEL', 'FOOD_DRINK', 'TRANSPORT'] as const,
      splitType: 'EQUAL' as const,
      categoriesTouched: true,
      splitTypeTouched: false,
    };
    const next = applyTypeChangeToTemplate(prev, 'ROOMMATES');
    expect(next.categoryOptions).toEqual(['TRAVEL', 'FOOD_DRINK', 'TRANSPORT']);
    expect(next.selectedCategories).toEqual(['TRAVEL', 'FOOD_DRINK', 'TRANSPORT']);
    expect(next.splitType).toBe('EQUAL'); // ROOMMATES template's split mode (untouched, refreshed)
  });

  it('preserves a touched split-mode override while the untouched category list still refreshes', () => {
    const prev = {
      categoryOptions: ['TRAVEL', 'FOOD_DRINK', 'TRANSPORT', 'ENTERTAINMENT'] as const,
      selectedCategories: ['TRAVEL', 'FOOD_DRINK', 'TRANSPORT', 'ENTERTAINMENT'] as const,
      splitType: 'SHARES' as const, // user overrode split mode
      categoriesTouched: false,
      splitTypeTouched: true,
    };
    const next = applyTypeChangeToTemplate(prev, 'ROOMMATES');
    expect(next.categoryOptions).toEqual(['RENT', 'UTILITIES', 'GROCERIES', 'HOME']);
    expect(next.selectedCategories).toEqual(['RENT', 'UTILITIES', 'GROCERIES', 'HOME']);
    expect(next.splitType).toBe('SHARES'); // preserved, never clobbered
  });

  it('never silently discards a fully-touched override, even switching to a type with no template', () => {
    const prev = {
      categoryOptions: ['TRAVEL'] as const,
      selectedCategories: ['TRAVEL'] as const,
      splitType: 'SHARES' as const,
      categoriesTouched: true,
      splitTypeTouched: true,
    };
    const next = applyTypeChangeToTemplate(prev, 'SUBSCRIPTION'); // no curated template
    expect(next).toEqual({
      categoryOptions: ['TRAVEL'],
      selectedCategories: ['TRAVEL'],
      splitType: 'SHARES',
    });
  });

  it('clears untouched fields (no stale leftover) when switching to a type with no curated template', () => {
    const next = applyTypeChangeToTemplate(untouched, 'SUBSCRIPTION');
    expect(next).toEqual({
      categoryOptions: [],
      selectedCategories: [],
      splitType: undefined,
    });
  });
});

describe('toggleCategorySelection', () => {
  it('adds a category that is not currently selected', () => {
    expect(toggleCategorySelection(['RENT'], 'UTILITIES')).toEqual(['RENT', 'UTILITIES']);
  });

  it('removes a category that is currently selected', () => {
    expect(toggleCategorySelection(['RENT', 'UTILITIES'], 'RENT')).toEqual(['UTILITIES']);
  });
});
