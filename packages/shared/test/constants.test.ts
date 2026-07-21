import { describe, expect, it } from 'vitest';
import {
  EXPENSE_CATEGORY_KEYS,
  GROUP_EMOJI_CHOICES,
  GROUP_EMOJI_KEYWORDS,
  GROUP_TEMPLATES,
  GROUP_TYPES,
  GROUP_TYPE_KEYS,
  SPLIT_TYPE_LABELS,
  groupTemplate,
  searchGroupEmoji,
} from '../src/constants';
import { SPLIT_TYPES } from '../src/split';
import { zGroupType } from '../src/schemas';

// WI-006 — GROUP_EMOJI_CHOICES: 100 curated emoji, single flat exported list.
describe('GROUP_EMOJI_CHOICES (WI-006)', () => {
  it('has exactly 100 entries', () => {
    expect(GROUP_EMOJI_CHOICES.length).toBe(100);
  });

  it('has no duplicate emoji across the eight source categories', () => {
    expect(new Set(GROUP_EMOJI_CHOICES).size).toBe(GROUP_EMOJI_CHOICES.length);
  });

  it('contains every GROUP_TYPES default emoji, so type-based auto-sync always highlights a real grid cell', () => {
    for (const t of GROUP_TYPES) {
      expect(GROUP_EMOJI_CHOICES).toContain(t.emoji);
    }
  });
});

// WI-007 — GROUP_TYPES: extended from 6 to 16 (10 new, additive only).
describe('GROUP_TYPES (WI-007)', () => {
  it('has exactly 16 entries', () => {
    expect(GROUP_TYPES.length).toBe(16);
  });

  it('keeps all 6 original types unchanged (key, label, emoji)', () => {
    const original = [
      { key: 'TRIP', label: 'Trip', emoji: '✈️' },
      { key: 'HOME', label: 'Home', emoji: '🏠' },
      { key: 'COUPLE', label: 'Couple', emoji: '❤️' },
      { key: 'FRIENDS', label: 'Friends', emoji: '👥' },
      { key: 'PROJECT', label: 'Project', emoji: '💼' },
      { key: 'OTHER', label: 'Other', emoji: '📋' },
    ];
    for (const o of original) {
      expect(GROUP_TYPES.find((t) => t.key === o.key)).toEqual(o);
    }
  });

  it('adds the 10 new types from spec-WI-007 with their exact key/label/emoji', () => {
    const added = [
      { key: 'FAMILY', label: 'Family', emoji: '👨‍👩‍👧‍👦' },
      { key: 'ROOMMATES', label: 'Roommates', emoji: '🔑' },
      { key: 'WORK', label: 'Work', emoji: '💻' },
      { key: 'CLUB', label: 'Club', emoji: '🎯' },
      { key: 'SPORTS_TEAM', label: 'Sports team', emoji: '⚽' },
      { key: 'EVENT', label: 'Event', emoji: '🎉' },
      { key: 'SCHOOL', label: 'School', emoji: '🎓' },
      { key: 'SUBSCRIPTION', label: 'Subscription', emoji: '💸' },
      { key: 'NIGHT_OUT', label: 'Night out', emoji: '🍻' },
      { key: 'CHARITY', label: 'Charity', emoji: '🤝' },
    ];
    for (const a of added) {
      expect(GROUP_TYPES.find((t) => t.key === a.key)).toEqual(a);
    }
  });

  it('every type default emoji is a member of GROUP_EMOJI_CHOICES (no dangling/invisible auto-sync value)', () => {
    for (const t of GROUP_TYPES) {
      expect(GROUP_EMOJI_CHOICES).toContain(t.emoji);
    }
  });

  it('GROUP_TYPE_KEYS is derived from GROUP_TYPES and has 16 unique keys', () => {
    expect(GROUP_TYPE_KEYS.length).toBe(16);
    expect(new Set(GROUP_TYPE_KEYS).size).toBe(16);
  });
});

// WI-007 — zGroupType must pick up the expansion automatically (no schemas.ts edit).
describe('zGroupType (WI-007 — derives from GROUP_TYPE_KEYS with zero schema edits)', () => {
  it('accepts every one of the 16 GROUP_TYPES keys, old and new', () => {
    for (const key of GROUP_TYPE_KEYS) {
      expect(zGroupType.parse(key)).toBe(key);
    }
  });

  it('still rejects an unknown/invalid type string', () => {
    expect(() => zGroupType.parse('NOT_A_REAL_TYPE')).toThrow();
  });
});

// WI-020 — GROUP_TEMPLATES: curated group-creation suggestions, read-only
// references into expenses-owned EXPENSE_CATEGORY_KEYS / SPLIT_TYPES.
describe('GROUP_TEMPLATES (WI-020)', () => {
  it('curates the client floor: ROOMMATES, TRIP, COUPLE all have an entry', () => {
    expect(GROUP_TEMPLATES.ROOMMATES).toBeDefined();
    expect(GROUP_TEMPLATES.TRIP).toBeDefined();
    expect(GROUP_TEMPLATES.COUPLE).toBeDefined();
  });

  it('curates exactly the 7 types named in spec-WI-020 D3', () => {
    const curated = ['ROOMMATES', 'HOME', 'TRIP', 'COUPLE', 'FAMILY', 'NIGHT_OUT', 'EVENT'].sort();
    expect(Object.keys(GROUP_TEMPLATES).sort()).toEqual(curated);
  });

  it('every categoryKeys entry is a real member of EXPENSE_CATEGORY_KEYS', () => {
    for (const template of Object.values(GROUP_TEMPLATES)) {
      for (const key of template!.categoryKeys) {
        expect(EXPENSE_CATEGORY_KEYS).toContain(key);
      }
    }
  });

  it('every splitType is a real member of SPLIT_TYPES', () => {
    for (const template of Object.values(GROUP_TEMPLATES)) {
      expect(SPLIT_TYPES).toContain(template!.splitType);
    }
  });

  it('every curated template has at least one category key', () => {
    for (const template of Object.values(GROUP_TEMPLATES)) {
      expect(template!.categoryKeys.length).toBeGreaterThan(0);
    }
  });

  it('groupTemplate() returns the entry for a curated type', () => {
    expect(groupTemplate('ROOMMATES')).toEqual({
      categoryKeys: ['RENT', 'UTILITIES', 'GROCERIES', 'HOME'],
      splitType: 'EQUAL',
    });
  });

  it('groupTemplate() returns undefined for a non-curated type (graceful degradation)', () => {
    for (const type of ['FRIENDS', 'PROJECT', 'WORK', 'CLUB', 'SPORTS_TEAM', 'SCHOOL', 'SUBSCRIPTION', 'CHARITY', 'OTHER'] as const) {
      expect(groupTemplate(type)).toBeUndefined();
    }
  });
});

// WI-031 — GROUP_EMOJI_KEYWORDS / searchGroupEmoji: presentational search data
// layered over GROUP_EMOJI_CHOICES. No inventory/behavior change.
describe('GROUP_EMOJI_KEYWORDS (WI-031)', () => {
  it('has a keyword entry for every GROUP_EMOJI_CHOICES member', () => {
    for (const emoji of GROUP_EMOJI_CHOICES) {
      expect(GROUP_EMOJI_KEYWORDS[emoji]).toBeDefined();
      expect(GROUP_EMOJI_KEYWORDS[emoji].length).toBeGreaterThan(0);
    }
  });

  it('has no keys outside GROUP_EMOJI_CHOICES (does not change the inventory)', () => {
    for (const key of Object.keys(GROUP_EMOJI_KEYWORDS)) {
      expect(GROUP_EMOJI_CHOICES).toContain(key as (typeof GROUP_EMOJI_CHOICES)[number]);
    }
  });

  it('every keyword string is lowercase (case-insensitive matching relies on this)', () => {
    for (const kw of Object.values(GROUP_EMOJI_KEYWORDS)) {
      expect(kw).toBe(kw.toLowerCase());
    }
  });
});

describe('searchGroupEmoji (WI-031)', () => {
  it('an empty query returns every GROUP_EMOJI_CHOICES member, in order', () => {
    expect(searchGroupEmoji('')).toEqual(GROUP_EMOJI_CHOICES);
  });

  it('a whitespace-only query is treated as empty (returns all)', () => {
    expect(searchGroupEmoji('   ')).toEqual(GROUP_EMOJI_CHOICES);
  });

  it('matches a case-insensitive substring of an emoji keyword string', () => {
    const results = searchGroupEmoji('BEACH');
    expect(results).toContain('🏖️');
    expect(results.length).toBeLessThan(GROUP_EMOJI_CHOICES.length);
  });

  it('matches keyword terms regardless of case', () => {
    expect(searchGroupEmoji('pizza')).toEqual(searchGroupEmoji('PiZzA'));
    expect(searchGroupEmoji('pizza')).toContain('🍕');
  });

  it('matches the baseline category term for every emoji in that category', () => {
    const travelResults = searchGroupEmoji('travel');
    expect(travelResults).toContain('✈️');
    expect(travelResults).toContain('🧳');
  });

  it('returns an empty array when no keyword matches', () => {
    expect(searchGroupEmoji('zzzznotarealkeyword')).toEqual([]);
  });

  it('trims surrounding whitespace before matching', () => {
    expect(searchGroupEmoji('  pizza  ')).toEqual(searchGroupEmoji('pizza'));
  });
});

// WI-020 — SPLIT_TYPE_LABELS: presentational labels, forced exhaustive over SPLIT_TYPES.
describe('SPLIT_TYPE_LABELS (WI-020)', () => {
  it('has a label for every SPLIT_TYPES member, and no extras', () => {
    expect(Object.keys(SPLIT_TYPE_LABELS).sort()).toEqual([...SPLIT_TYPES].sort());
  });

  it('every label is a non-empty string', () => {
    for (const label of Object.values(SPLIT_TYPE_LABELS)) {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
