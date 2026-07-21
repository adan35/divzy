/**
 * WI-042 — client-side type-ahead filter core (spec-WI-042 D2/D3).
 *
 * Case-insensitive substring match, no accent/diacritic folding — exact
 * parity with the existing `currency-select`/`CurrencyPicker` `.includes()`
 * behavior being generalized (see spec §1 D2). Purely client-side: no
 * network, no async. Shared by mobile's generic `SearchPicker<T>` so the
 * matching rule has one tested source of truth.
 */
export function filterBySearch<T>(
  items: readonly T[],
  query: string,
  getSearchText: (item: T) => string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((item) => getSearchText(item).toLowerCase().includes(q));
}
