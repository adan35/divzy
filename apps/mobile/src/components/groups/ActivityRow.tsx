import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatMoney, type ActivityDto, type ActivityType } from '@divzy/shared';
import { formatRelative } from '@/lib/format';
import { fontSize, spacing, useTheme } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;

const TYPE_ICONS: Record<ActivityType, IconName> = {
  EXPENSE_ADDED: 'receipt-outline',
  EXPENSE_UPDATED: 'create-outline',
  EXPENSE_DELETED: 'trash-outline',
  SETTLEMENT_ADDED: 'swap-horizontal',
  SETTLEMENT_DELETED: 'trash-outline',
  GROUP_CREATED: 'people-outline',
  GROUP_UPDATED: 'settings-outline',
  MEMBER_JOINED: 'person-add-outline',
  MEMBER_LEFT: 'exit-outline',
  MEMBER_REMOVED: 'person-remove-outline',
  COMMENT_ADDED: 'chatbubble-outline',
  FRIEND_ADDED: 'person-add-outline',
  RECURRING_POSTED: 'repeat-outline',
};

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

/** Human sentence for any activity type, with "You" for the current user. */
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
    case 'GROUP_UPDATED':
      return `${actor} updated the group settings`;
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

export interface ActivityRowProps {
  activity: ActivityDto;
  currentUserId?: string;
}

/** Feed row: type icon, sentence, relative time + group context. Taps open the related expense or group. */
export function ActivityRow({ activity, currentUserId }: ActivityRowProps) {
  const router = useRouter();
  const { colors } = useTheme();

  const target = activity.expenseId
    ? `/expense/${activity.expenseId}`
    : activity.group
      ? `/group/${activity.group.id}`
      : null;

  const meta = `${formatRelative(activity.createdAt)}${
    activity.group ? ` · ${activity.group.emoji} ${activity.group.name}` : ''
  }`;

  return (
    <Pressable
      accessibilityRole={target ? 'button' : undefined}
      disabled={!target}
      onPress={target ? () => router.push(target) : undefined}
      style={({ pressed }) => [styles.row, pressed && target ? { backgroundColor: colors.surface2 } : null]}
    >
      <View style={[styles.iconBubble, { backgroundColor: colors.surface2 }]}>
        <Ionicons name={TYPE_ICONS[activity.type] ?? 'flash-outline'} size={17} color={colors.ink2} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.sentence, { color: colors.ink }]}>
          {activitySentence(activity, currentUserId)}
        </Text>
        <Text numberOfLines={1} style={[styles.meta, { color: colors.ink3 }]}>
          {meta}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderRadius: 10,
  },
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
    marginTop: 1,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  sentence: {
    fontSize: fontSize.md,
    lineHeight: 20,
  },
  meta: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
});
