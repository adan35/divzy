// WI-063 (expenses) — zUsedCategoriesQuery gains an optional `friendId` as an
// alternative scope to `groupId`, at most one of the two allowed.
// Additive/backward-compatible: existing groupId-only callers keep working.
// WI-064 relaxes the refine further: neither id is now allowed too (unscoped
// = all of the caller's expenses).
// Spec: .company/domains/expenses/specs/spec-WI-063.md §3.1,
//       .company/domains/expenses/specs/spec-WI-064.md §3.1
import { describe, expect, it } from 'vitest';
import { zUsedCategoriesQuery } from '../src/schemas';

const GROUP_ID = 'grp_12345678';
const FRIEND_ID = 'frn_12345678';

describe('zUsedCategoriesQuery (WI-063)', () => {
  it('accepts groupId alone', () => {
    const result = zUsedCategoriesQuery.parse({ groupId: GROUP_ID });
    expect(result).toEqual({ groupId: GROUP_ID });
  });

  it('accepts friendId alone', () => {
    const result = zUsedCategoriesQuery.parse({ friendId: FRIEND_ID });
    expect(result).toEqual({ friendId: FRIEND_ID });
  });

  it('rejects both groupId and friendId provided together', () => {
    expect(() => zUsedCategoriesQuery.parse({ groupId: GROUP_ID, friendId: FRIEND_ID })).toThrow(
      'Provide at most one of groupId or friendId',
    );
  });

  it('accepts neither groupId nor friendId provided (WI-064 unscoped)', () => {
    const result = zUsedCategoriesQuery.parse({});
    expect(result).toEqual({});
  });

  it('rejects a groupId that fails the shared id-shape validation', () => {
    expect(() => zUsedCategoriesQuery.parse({ groupId: 'short' })).toThrow();
  });

  it('rejects a friendId that fails the shared id-shape validation', () => {
    expect(() => zUsedCategoriesQuery.parse({ friendId: 'short' })).toThrow();
  });
});
