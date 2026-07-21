// WI-041 (auth's slice, ADR-021) — canonical NOTIFICATION_CATEGORIES constant
// + derived zNotificationCategory enum. Must stay byte-identical to the
// Prisma NotificationCategory enum (DRB architecture condition C2).
import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_KEYS,
  isAvailableNotificationCategory,
  zNotificationCategory,
} from '../src/constants';
import { zUpdateNotificationPreferencesInput } from '../src/schemas';

const EXPECTED_KEYS = [
  'EXPENSE_ADDED',
  'EXPENSE_EDITED',
  'EXPENSE_DELETED',
  'COMMENT',
  'PAYMENT_RECEIVED',
  'GROUP_INVITE',
  'EXPENSE_DUE',
  'MONTHLY_SUMMARY',
  'PRODUCT_NEWS',
];

const EXPECTED_AVAILABLE = new Set([
  'EXPENSE_ADDED',
  'EXPENSE_EDITED',
  'EXPENSE_DELETED',
  'COMMENT',
  'PAYMENT_RECEIVED',
  'GROUP_INVITE',
]);

describe('NOTIFICATION_CATEGORIES (WI-041)', () => {
  it('has exactly the 9 canonical keys, in the documented order', () => {
    expect(NOTIFICATION_CATEGORIES.map((c) => c.key)).toEqual(EXPECTED_KEYS);
    expect(NOTIFICATION_CATEGORY_KEYS).toEqual(EXPECTED_KEYS);
  });

  it('marks exactly the 6 buildable-now categories available, and the 3 deferred ones unavailable', () => {
    for (const c of NOTIFICATION_CATEGORIES) {
      expect(c.available).toBe(EXPECTED_AVAILABLE.has(c.key));
    }
    expect(NOTIFICATION_CATEGORIES.filter((c) => c.available)).toHaveLength(6);
    expect(NOTIFICATION_CATEGORIES.filter((c) => !c.available)).toHaveLength(3);
  });

  it('isAvailableNotificationCategory reflects the available flag', () => {
    expect(isAvailableNotificationCategory('EXPENSE_ADDED')).toBe(true);
    expect(isAvailableNotificationCategory('PRODUCT_NEWS')).toBe(false);
    expect(isAvailableNotificationCategory('NOT_A_CATEGORY')).toBe(false);
  });

  it('zNotificationCategory accepts every canonical key and rejects unknown keys', () => {
    for (const key of EXPECTED_KEYS) {
      expect(zNotificationCategory.parse(key)).toBe(key);
    }
    expect(() => zNotificationCategory.parse('NOT_A_CATEGORY')).toThrow();
  });
});

describe('zUpdateNotificationPreferencesInput (WI-041)', () => {
  it('accepts a partial single-cell update', () => {
    const result = zUpdateNotificationPreferencesInput.parse({
      preferences: [{ category: 'COMMENT', pushEnabled: false }],
    });
    expect(result.preferences).toEqual([{ category: 'COMMENT', pushEnabled: false }]);
  });

  it('accepts the reserved/deferred categories too (forward-compat; schema does not gate availability)', () => {
    const result = zUpdateNotificationPreferencesInput.parse({
      preferences: [{ category: 'PRODUCT_NEWS', pushEnabled: true }],
    });
    expect(result.preferences[0]?.category).toBe('PRODUCT_NEWS');
  });

  it('rejects an unknown category with a validation error (never silently dropped)', () => {
    expect(() =>
      zUpdateNotificationPreferencesInput.parse({
        preferences: [{ category: 'NOT_A_CATEGORY', pushEnabled: true }],
      }),
    ).toThrow();
  });

  it('rejects a non-boolean channel value', () => {
    expect(() =>
      zUpdateNotificationPreferencesInput.parse({
        preferences: [{ category: 'COMMENT', pushEnabled: 'yes' }],
      }),
    ).toThrow();
  });

  it('rejects an empty preferences array', () => {
    expect(() => zUpdateNotificationPreferencesInput.parse({ preferences: [] })).toThrow();
  });

  it('never accepts a userId field anywhere in the shape (IDOR guard by construction)', () => {
    const result = zUpdateNotificationPreferencesInput.parse({
      preferences: [{ category: 'COMMENT', userId: 'user_other', pushEnabled: true }],
    });
    // zod strips unknown keys by default — userId must not survive parsing.
    expect((result.preferences[0] as Record<string, unknown>).userId).toBeUndefined();
  });
});
