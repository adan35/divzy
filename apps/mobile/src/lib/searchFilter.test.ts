import { describe, expect, it } from 'vitest';
import { filterBySearch } from './searchFilter';

// WI-042 — type-ahead filter core (spec-WI-042 D2/D3): case-insensitive
// substring match, no accent folding, purely client-side — shared by
// mobile's generic SearchPicker<T> (CurrencyPicker + ContextPicker wrappers).

interface Item {
  key: string;
  label: string;
}

const roommates: Item = { key: 'g1', label: 'Roommates' };
const lahoreTrip: Item = { key: 'g2', label: 'Lahore Trip' };
const bookClub: Item = { key: 'g3', label: 'Book Club' };
const items = [roommates, lahoreTrip, bookClub];

describe('filterBySearch (WI-042)', () => {
  it('returns every item when the query is empty', () => {
    expect(filterBySearch(items, '', (i) => i.label)).toEqual(items);
  });

  it('returns every item when the query is only whitespace', () => {
    expect(filterBySearch(items, '   ', (i) => i.label)).toEqual(items);
  });

  it('matches a case-insensitive substring', () => {
    expect(filterBySearch(items, 'trip', (i) => i.label)).toEqual([lahoreTrip]);
    expect(filterBySearch(items, 'TRIP', (i) => i.label)).toEqual([lahoreTrip]);
    expect(filterBySearch(items, 'Trip', (i) => i.label)).toEqual([lahoreTrip]);
  });

  it('matches a substring anywhere in the label, not just a prefix', () => {
    expect(filterBySearch(items, 'ah', (i) => i.label)).toEqual([lahoreTrip]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterBySearch(items, 'xyz', (i) => i.label)).toEqual([]);
  });

  it('does not fold accents/diacritics (parity with currency-select/CurrencyPicker, by design)', () => {
    const cafe: Item = { key: 'c1', label: 'Café' };
    expect(filterBySearch([cafe], 'cafe', (i) => i.label)).toEqual([]);
    expect(filterBySearch([cafe], 'café', (i) => i.label)).toEqual([cafe]);
  });

  it('preserves the original list order for surviving matches', () => {
    const friends: Item[] = [
      { key: 'f1', label: 'Ana' },
      { key: 'f2', label: 'Bilal' },
      { key: 'f3', label: 'Anas' },
    ];
    expect(filterBySearch(friends, 'an', (i) => i.label)).toEqual([friends[0], friends[2]]);
  });
});
