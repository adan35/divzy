import { describe, expect, it } from 'vitest';
import type { ActivityDto } from '@divzy/shared';
import { resolveActivityDestination } from './activity-nav';

// WI-039 (notifications-activity slice): per ADR-022, routing dispatch for an
// activity feed row is decided once, uniformly, per §3 of spec-WI-039 — no
// ad-hoc per-row decisions, and no ActivityType falls through unhandled.

const actor = { id: 'actor-1', name: 'Alex', avatarColor: '#111' };
const viewer = { id: 'viewer-1', name: 'Viewer', avatarColor: '#222' };
const group = { id: 'group-1', name: 'Lisbon', emoji: '✈️' };

function activity(overrides: Partial<ActivityDto> = {}): ActivityDto {
  return {
    id: 'act-1',
    type: 'EXPENSE_ADDED',
    actor,
    group: null,
    expenseId: null,
    settlementId: null,
    data: {},
    deletedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolveActivityDestination', () => {
  it('routes every expenseId-bearing type to the expense dialog, regardless of group presence (§3a)', () => {
    const types: ActivityDto['type'][] = [
      'EXPENSE_ADDED',
      'EXPENSE_UPDATED',
      'EXPENSE_DELETED',
      'COMMENT_ADDED',
      'RECURRING_POSTED',
    ];
    for (const type of types) {
      expect(
        resolveActivityDestination(activity({ type, expenseId: 'exp-1', group }), viewer.id),
      ).toEqual({ kind: 'expense', expenseId: 'exp-1' });
      expect(
        resolveActivityDestination(activity({ type, expenseId: 'exp-1', group: null }), viewer.id),
      ).toEqual({ kind: 'expense', expenseId: 'exp-1' });
    }
  });

  it('routes group-scoped settlement activity to the settlement detail dialog, not the group (WI-039b §1)', () => {
    expect(
      resolveActivityDestination(
        activity({ type: 'SETTLEMENT_ADDED', settlementId: 's1', group }),
        viewer.id,
      ),
    ).toEqual({ kind: 'settlement', settlementId: 's1' });
    expect(
      resolveActivityDestination(
        activity({ type: 'SETTLEMENT_DELETED', settlementId: 's1', group }),
        viewer.id,
      ),
    ).toEqual({ kind: 'settlement', settlementId: 's1' });
  });

  it('routes a direct (no-group) settlement to the settlement detail dialog too, regardless of viewer/actor (WI-039b §1)', () => {
    expect(
      resolveActivityDestination(
        activity({ type: 'SETTLEMENT_ADDED', settlementId: 's1', group: null, actor }),
        viewer.id,
      ),
    ).toEqual({ kind: 'settlement', settlementId: 's1' });
    expect(
      resolveActivityDestination(
        activity({ type: 'SETTLEMENT_DELETED', settlementId: 's1', group: null, actor: viewer }),
        viewer.id,
      ),
    ).toEqual({ kind: 'settlement', settlementId: 's1' });
  });

  it.each([
    'GROUP_CREATED',
    'GROUP_UPDATED',
    'MEMBER_JOINED',
    'MEMBER_LEFT',
    'MEMBER_REMOVED',
  ] as const)('routes %s to the group page (§3c)', (type) => {
    expect(resolveActivityDestination(activity({ type, group }), viewer.id)).toEqual({
      kind: 'group',
      groupId: 'group-1',
    });
  });

  it('routes FRIEND_ADDED to the actor when the viewer is not the actor (§3c)', () => {
    expect(
      resolveActivityDestination(
        activity({ type: 'FRIEND_ADDED', group: null, actor, data: { friendId: 'someone-else' } }),
        viewer.id,
      ),
    ).toEqual({ kind: 'friend', friendId: actor.id });
  });

  it('routes FRIEND_ADDED to data.friendId when the viewer IS the actor — closes the dead-click gap (§3c)', () => {
    expect(
      resolveActivityDestination(
        activity({
          type: 'FRIEND_ADDED',
          group: null,
          actor: viewer,
          data: { friendId: 'the-new-friend' },
        }),
        viewer.id,
      ),
    ).toEqual({ kind: 'friend', friendId: 'the-new-friend' });
  });

  it('never falls through to an error for any non-expense ActivityType (§3e)', () => {
    const types: ActivityDto['type'][] = [
      'SETTLEMENT_ADDED',
      'SETTLEMENT_DELETED',
      'GROUP_CREATED',
      'GROUP_UPDATED',
      'MEMBER_JOINED',
      'MEMBER_LEFT',
      'MEMBER_REMOVED',
      'FRIEND_ADDED',
    ];
    for (const type of types) {
      const dest = resolveActivityDestination(activity({ type, group: null }), viewer.id);
      expect(dest.kind).not.toBe('error');
      expect(dest).toBeDefined();
    }
  });
});
