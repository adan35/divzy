import { groupTemplate, type ExpenseCategory, type GroupType, type SplitType } from '@divzy/shared';

/**
 * WI-020 — group-creation templates (mobile). Pure, dependency-free logic
 * backing the create-only "Suggested" block in apps/mobile/app/group-form.tsx.
 * Kept out of the RN component (which has no render-test harness in this
 * workspace) so the D3/D4 merge rule is fully unit-testable, mirroring
 * src/lib/toast.ts / copyInvite.ts's existing "logic in src/lib, thin JSX in
 * app/*" split.
 */

export interface TemplateFieldState {
  /** The candidate chip list shown for the current type (frozen while touched). */
  categoryOptions: readonly ExpenseCategory[];
  /** The subset of categoryOptions currently toggled on. */
  selectedCategories: readonly ExpenseCategory[];
  /** Suggested split mode; undefined when the type has no curated template. */
  splitType: SplitType | undefined;
}

export interface TemplateSelectionState extends TemplateFieldState {
  categoriesTouched: boolean;
  splitTypeTouched: boolean;
}

/** Seed template state for a freshly-selected type (used on initial create-form mount). */
export function initialTemplateState(type: GroupType): TemplateFieldState {
  const template = groupTemplate(type);
  return {
    categoryOptions: template?.categoryKeys ?? [],
    selectedCategories: template?.categoryKeys ?? [],
    splitType: template?.splitType,
  };
}

/**
 * Spec-WI-020 D4: on type change, for each field independently — if
 * untouched, replace it with the new type's template value (or clear it if
 * the new type has no template); if the user has already overridden it
 * (touched), leave the override intact, never silently clobbered.
 */
export function applyTypeChangeToTemplate(
  prev: TemplateSelectionState,
  nextType: GroupType,
): TemplateFieldState {
  const nextTemplate = groupTemplate(nextType);
  return {
    categoryOptions: prev.categoriesTouched ? prev.categoryOptions : nextTemplate?.categoryKeys ?? [],
    selectedCategories: prev.categoriesTouched
      ? prev.selectedCategories
      : nextTemplate?.categoryKeys ?? [],
    splitType: prev.splitTypeTouched ? prev.splitType : nextTemplate?.splitType,
  };
}

/** Toggle a single category key on/off within the currently-selected subset. */
export function toggleCategorySelection(
  selected: readonly ExpenseCategory[],
  key: ExpenseCategory,
): readonly ExpenseCategory[] {
  return selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
}
