import { formatMoney, type ActivityDto } from '@divzy/shared';

function str(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function money(data: Record<string, unknown>): string | null {
  const amount = data['amount'];
  const currency = data['currency'];
  if (typeof amount === 'number' && Number.isInteger(amount) && typeof currency === 'string') {
    try {
      return formatMoney(amount, currency);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Human sentence for any activity type, with "You" for the current user.
 * Kept separate from `ActivityRow` (no RN render harness in this repo — see
 * apps/mobile agent-memory gap_mobile-no-render-harness.md) so this
 * business-logic mapping is unit testable.
 */
export function activitySentence(activity: ActivityDto, currentUserId?: string): string {
  const actor = activity.actor.id === currentUserId ? 'You' : activity.actor.name;
  const data = activity.data ?? {};
  const description = str(data, 'description');
  const amountText = money(data);
  const withAmount = (base: string) => (amountText ? `${base} · ${amountText}` : base);

  switch (activity.type) {
    case 'EXPENSE_ADDED':
      return withAmount(`${actor} added ${description ? `“${description}”` : 'an expense'}`);
    case 'EXPENSE_UPDATED':
      return withAmount(`${actor} updated ${description ? `“${description}”` : 'an expense'}`);
    case 'EXPENSE_DELETED':
      return `${actor} deleted ${description ? `“${description}”` : 'an expense'}`;
    case 'SETTLEMENT_ADDED': {
      const fromName = str(data, 'fromName') ?? actor;
      const toName = str(data, 'toName') ?? 'someone';
      return withAmount(`${fromName} paid ${toName}`);
    }
    case 'SETTLEMENT_DELETED':
      return withAmount(`${actor} deleted a payment`);
    case 'GROUP_CREATED':
      return `${actor} created ${activity.group ? `“${activity.group.name}”` : 'a group'}`;
    case 'GROUP_UPDATED': {
      // WI-062 (spec-WI-062 §3) — `recordActivity` already disambiguates
      // archive/delete on `data`; branch the verb rather than always saying
      // "updated". Precedence: deleted > archived > updated. `archived:
      // false` (unarchive) and the no-flag plain update both fall through to
      // "updated" — the story's regression guard.
      const verb =
        data['deleted'] === true ? 'deleted' : data['archived'] === true ? 'archived' : 'updated';
      return `${actor} ${verb} the group settings`;
    }
    case 'MEMBER_JOINED': {
      const memberName = str(data, 'memberName') ?? str(data, 'name');
      if (memberName && memberName !== activity.actor.name) {
        return `${actor} added ${memberName} to the group`;
      }
      return `${actor} joined the group`;
    }
    case 'MEMBER_LEFT':
      return `${actor} left the group`;
    case 'MEMBER_REMOVED': {
      const memberName = str(data, 'memberName') ?? str(data, 'name');
      return `${actor} removed ${memberName ?? 'a member'} from the group`;
    }
    case 'COMMENT_ADDED':
      return description
        ? `${actor} commented on “${description}”`
        : `${actor} added a comment`;
    case 'FRIEND_ADDED': {
      const friendName = str(data, 'friendName') ?? str(data, 'name');
      return friendName
        ? `${actor} added ${friendName} as a friend`
        : `${actor} added a new friend`;
    }
    case 'RECURRING_POSTED':
      return withAmount(
        description
          ? `Recurring expense “${description}” was posted automatically`
          : 'A recurring expense was posted automatically',
      );
    default:
      return `${actor} made a change`;
  }
}
