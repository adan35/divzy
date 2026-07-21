import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@divzy/shared';

export type CategoryCell = (typeof EXPENSE_CATEGORIES)[number];

export interface CategoryPickerGridParams {
  /** Undefined for a non-group (direct/friend) expense — never narrow. */
  groupId: string | undefined;
  /** The form's current category value — always unioned into the narrowed set (D5). */
  value: ExpenseCategory;
  /** True once the "more categories" cell has been tapped. */
  showAll: boolean;
  usedCategories: ExpenseCategory[] | undefined;
  isLoading: boolean;
  isError: boolean;
}

export interface CategoryPickerGrid {
  /** The cells to render — full 16 or the narrowed subset, canonical order (D8). */
  cells: readonly CategoryCell[];
  /** True when the full 16-grid is shown (no "more categories" affordance to render). */
  showFull: boolean;
}

/**
 * WI-032-3 — pure narrowing logic behind the mobile category picker,
 * mirroring web's expense-editor.tsx D4-D8 byte-for-byte in intent.
 *
 * Deliberately checks `usedSet.size === 0`, not the narrowed cells' length
 * (which is never 0 — `value` is always unioned in): this is what makes the
 * brand-new/empty-group AC ("full 16-grid, not empty") actually fire (D6).
 */
export function categoryPickerGrid(params: CategoryPickerGridParams): CategoryPickerGrid {
  const usedSet = new Set(params.usedCategories ?? []);
  const showFull =
    !params.groupId ||
    params.showAll ||
    params.isLoading ||
    params.isError ||
    usedSet.size === 0;
  const cells = showFull
    ? EXPENSE_CATEGORIES
    : EXPENSE_CATEGORIES.filter((c) => usedSet.has(c.key) || c.key === params.value);
  return { cells, showFull };
}
