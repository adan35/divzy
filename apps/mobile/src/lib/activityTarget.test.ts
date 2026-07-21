import { describe, expect, it } from 'vitest';
import type { ActivityDto } from '@divzy/shared';
import { resolveActivityTarget } from './activityTarget';

// WI-039 — activity row tap-target dispatch (ADR-022 §3): expense-backed
// items keep the existing /expense/:id route; settlement/membership items
// link through to the group or friend page; FRIEND_ADDED closes the
// previously-disabled dead click. Mirrors ADR-022's exhaustive per-type
// coverage (§3e) so no ActivityType silently falls through.

const actor = {
  id: 'actor-1',
  name: 'Alex',
  avatarUrl: null,
  avatarColor: '#000000',
} as ActivityDto['actor'];
const group = { id: 'group-1', name: 'Trip', emoji: '✈️' };

function activity(overrides: Partial<ActivityDto>): ActivityDto {
  return {
    id: 'a1',
    type: 'EXPENSE_ADDED',
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

describe('resolveActivityTarget (WI-039)', () => {
  it('routes every expenseId-bearing type straight to the existing expense detail screen', () => {
    for (const type of [
      'EXPENSE_ADDED',
      'EXPENSE_UPDATED',
      'EXPENSE_DELETED',
      'EXPENSE_RESTORED',
      'COMMENT_ADDED',
      'RECURRING_POSTED',
    ] as const) {
      expect(
        resolveActivityTarget(activity({ type, expenseId: 'exp-1', group }), 'viewer-1'),
      ).toBe('/expense/exp-1');
    }
  });

  it('routes a group-scoped settlement to the modal-presented settlement detail route (WI-039b)', () => {
    expect(
      resolveActivityTarget(
        activity({ type: 'SETTLEMENT_ADDED', settlementId: 's1', group }),
        'viewer-1',
      ),
    ).toBe('/settlement/s1');
    expect(
      resolveActivityTarget(
        activity({ type: 'SETTLEMENT_DELETED', settlementId: 's1', group }),
        'viewer-1',
      ),
    ).toBe('/settlement/s1');
    expect(
      resolveActivityTarget(
        activity({ type: 'SETTLEMENT_RESTORED', settlementId: 's1', group }),
        'viewer-1',
      ),
    ).toBe('/settlement/s1');
  });

  it('routes a direct (no-group) settlement to the same modal-presented settlement detail route (WI-039b)', () => {
    // Both group-scoped and direct settlements collapse to the same
    // settlement-id-keyed route now — the detail screen itself resolves
    // group context and counterparties server-side, so mobile no longer
    // needs to pre-resolve a counterparty id client-side.
    expect(
      resolveActivityTarget(
        activity({ type: 'SETTLEMENT_ADDED', settlementId: 's1', group: null }),
        'viewer-1',
      ),
    ).toBe('/settlement/s1');
    expect(
      resolveActivityTarget(
        activity({ type: 'SETTLEMENT_ADDED', settlementId: 's1', group: null }),
        'actor-1',
      ),
    ).toBe('/settlement/s1');
    expect(
      resolveActivityTarget(
        activity({ type: 'SETTLEMENT_DELETED', settlementId: 's1', group: null }),
        'viewer-1',
      ),
    ).toBe('/settlement/s1');
  });

  it('falls back to the pre-WI-039b group/friend link-through when settlementId is unexpectedly absent (defensive, corrupt/legacy row)', () => {
    expect(
      resolveActivityTarget(
        activity({ type: 'SETTLEMENT_ADDED', settlementId: null, group }),
        'viewer-1',
      ),
    ).toBe('/group/group-1');
    expect(
      resolveActivityTarget(
        activity({ type: 'SETTLEMENT_ADDED', settlementId: null, group: null }),
        'viewer-1',
      ),
    ).toBe('/friend/actor-1');
    expect(
      resolveActivityTarget(
        activity({ type: 'SETTLEMENT_ADDED', settlementId: null, group: null }),
        'actor-1',
      ),
    ).toBe('/(tabs)/friends');
  });

  it('routes membership/group events to the group page', () => {
    for (const type of [
      'GROUP_CREATED',
      'GROUP_UPDATED',
      'MEMBER_JOINED',
      'MEMBER_LEFT',
      'MEMBER_REMOVED',
    ] as const) {
      expect(resolveActivityTarget(activity({ type, group }), 'viewer-1')).toBe('/group/group-1');
    }
  });

  it('closes the FRIEND_ADDED dead click by linking to the friend added, when the viewer is the actor', () => {
    expect(
      resolveActivityTarget(
        activity({ type: 'FRIEND_ADDED', data: { friendId: 'friend-9', friendName: 'Sam' } }),
        'actor-1',
      ),
    ).toBe('/friend/friend-9');
  });

  it('closes the FRIEND_ADDED dead click by linking to the actor, when the viewer is the recipient of the add', () => {
    expect(
      resolveActivityTarget(
        activity({ type: 'FRIEND_ADDED', data: { friendId: 'viewer-1', friendName: 'Viewer' } }),
        'viewer-1',
      ),
    ).toBe('/friend/actor-1');
  });

  it('never falls through for any ActivityType (exhaustive per ADR-022 §3e)', () => {
    const allTypes: ActivityDto['type'][] = [
      'EXPENSE_ADDED',
      'EXPENSE_UPDATED',
      'EXPENSE_DELETED',
      'EXPENSE_RESTORED',
      'SETTLEMENT_ADDED',
      'SETTLEMENT_DELETED',
      'SETTLEMENT_RESTORED',
      'GROUP_CREATED',
      'GROUP_UPDATED',
      'MEMBER_JOINED',
      'MEMBER_LEFT',
      'MEMBER_REMOVED',
      'COMMENT_ADDED',
      'FRIEND_ADDED',
      'RECURRING_POSTED',
    ];
    for (const type of allTypes) {
      const result = resolveActivityTarget(
        activity({ type, expenseId: null, settlementId: null, group, data: { friendId: 'x' } }),
        'viewer-1',
      );
      expect(result).not.toBeNull();
    }
  });

  it('membership event with no group present is a defined no-op (null), not a throw', () => {
    expect(() =>
      resolveActivityTarget(activity({ type: 'GROUP_UPDATED', group: null }), 'viewer-1'),
    ).not.toThrow();
  });
});
