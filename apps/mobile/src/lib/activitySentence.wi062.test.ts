import { describe, expect, it } from 'vitest';
import type { ActivityDto } from '@divzy/shared';
import { activitySentence } from './activitySentence';

// Tests written from spec-WI-062 §3/§4 Surface 3 (mobile GROUP_UPDATED verb
// precedence: deleted > archived > updated) before the fix — the current
// implementation renders every GROUP_UPDATED row as "updated" unconditionally.

const actor = {
  id: 'actor-1',
  name: 'Priya',
  avatarUrl: null,
  avatarColor: '#000000',
} as ActivityDto['actor'];

function activity(overrides: Partial<ActivityDto>): ActivityDto {
  return {
    id: 'a1',
    type: 'GROUP_UPDATED',
    actor,
    group: null,
    expenseId: null,
    settlementId: null,
    data: {},
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('activitySentence GROUP_UPDATED verb precedence (WI-062)', () => {
  it('renders "deleted" when data.deleted === true, for another actor', () => {
    expect(
      activitySentence(activity({ data: { groupName: 'Ski Trip', deleted: true } }), 'viewer-1'),
    ).toBe('Priya deleted the group settings');
  });

  it('renders "deleted" with "You" when the caller is the actor', () => {
    expect(
      activitySentence(
        activity({ data: { groupName: 'Ski Trip', deleted: true } }),
        'actor-1',
      ),
    ).toBe('You deleted the group settings');
  });

  it('renders "archived" when data.archived === true, for another actor', () => {
    expect(
      activitySentence(activity({ data: { groupName: 'Ski Trip', archived: true } }), 'viewer-1'),
    ).toBe('Priya archived the group settings');
  });

  it('renders "archived" with "You" when the caller is the actor', () => {
    expect(
      activitySentence(
        activity({ data: { groupName: 'Ski Trip', archived: true } }),
        'actor-1',
      ),
    ).toBe('You archived the group settings');
  });

  it('falls through to "updated" when archived === false (unarchive regression guard)', () => {
    expect(
      activitySentence(activity({ data: { groupName: 'Ski Trip', archived: false } }), 'viewer-1'),
    ).toBe('Priya updated the group settings');
  });

  it('falls through to "updated" when neither flag is present (plain update)', () => {
    expect(
      activitySentence(
        activity({ data: { groupName: 'Ski Trip', changedFields: ['name'] } }),
        'viewer-1',
      ),
    ).toBe('Priya updated the group settings');
  });

  it('deleted takes precedence over archived if both were somehow present', () => {
    expect(
      activitySentence(
        activity({ data: { deleted: true, archived: true } }),
        'viewer-1',
      ),
    ).toBe('Priya deleted the group settings');
  });

  it('does not crash and needs no group reference when activity.group is null', () => {
    expect(
      activitySentence(activity({ group: null, data: { deleted: true } }), 'viewer-1'),
    ).toBe('Priya deleted the group settings');
  });
});
