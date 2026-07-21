import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { ActivityDto, ActivityType } from '@divzy/shared';
import { activitySentence } from '@/lib/activitySentence';
import { activityRowVisualState } from '@/lib/activityRowStyle';
import { resolveActivityTarget } from '@/lib/activityTarget';
import { formatRelative } from '@/lib/format';
import { fontSize, spacing, useTheme, withAlpha } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;

const TYPE_ICONS: Record<ActivityType, IconName> = {
  EXPENSE_ADDED: 'receipt-outline',
  EXPENSE_UPDATED: 'create-outline',
  EXPENSE_DELETED: 'trash-outline',
  // WI-054 — RESTORED rows never surface as their own feed row (the collapse
  // algorithm folds them into their ADDED anchor's `deletedAt`), but the enum
  // member still needs an icon for this Record to stay exhaustive.
  EXPENSE_RESTORED: 'refresh-outline',
  SETTLEMENT_ADDED: 'swap-horizontal',
  SETTLEMENT_DELETED: 'trash-outline',
  SETTLEMENT_RESTORED: 'refresh-outline',
  GROUP_CREATED: 'people-outline',
  GROUP_UPDATED: 'settings-outline',
  MEMBER_JOINED: 'person-add-outline',
  MEMBER_LEFT: 'exit-outline',
  MEMBER_REMOVED: 'person-remove-outline',
  COMMENT_ADDED: 'chatbubble-outline',
  FRIEND_ADDED: 'person-add-outline',
  RECURRING_POSTED: 'repeat-outline',
};

export interface ActivityRowProps {
  activity: ActivityDto;
  currentUserId?: string;
}

/**
 * Feed row: type icon, sentence, relative time + group context. Taps
 * navigate per `resolveActivityTarget` (WI-039/ADR-022) — expense-backed
 * items go straight to the expense detail screen; settlement/membership
 * items link through to the group or friend page; `FRIEND_ADDED` is no
 * longer a dead click.
 *
 * WI-054 — a row whose entity is currently deleted (`activity.deletedAt !=
 * null`) strikes through the sentence and dims the row, but stays tappable
 * to the existing (read-only) detail screen — no restore affordance yet
 * (Part 2 is blocked on expenses/settlements, spec-WI-054 §5).
 * WI-055 — otherwise, `activity.colorHint` tints the icon bubble with this
 * app's existing `colors.pos`/`colors.neg` tokens (same ones `MoneyText`/
 * `ExpenseRow` use), never a new color.
 */
export function ActivityRow({ activity, currentUserId }: ActivityRowProps) {
  const router = useRouter();
  const { colors } = useTheme();

  const target = resolveActivityTarget(activity, currentUserId);
  const { struck, accent } = activityRowVisualState(activity);
  const accentColor = accent === 'pos' ? colors.pos : accent === 'neg' ? colors.neg : null;

  const meta = `${formatRelative(activity.createdAt)}${
    activity.group ? ` · ${activity.group.emoji} ${activity.group.name}` : ''
  }`;

  return (
    <Pressable
      accessibilityRole={target ? 'button' : undefined}
      disabled={!target}
      onPress={target ? () => router.push(target) : undefined}
      style={({ pressed }) => [
        styles.row,
        struck && styles.struckRow,
        pressed && target ? { backgroundColor: colors.surface2 } : null,
      ]}
    >
      <View
        style={[
          styles.iconBubble,
          { backgroundColor: accentColor ? withAlpha(accentColor, 0.15) : colors.surface2 },
        ]}
      >
        <Ionicons
          name={TYPE_ICONS[activity.type] ?? 'flash-outline'}
          size={17}
          color={accentColor ?? colors.ink2}
        />
      </View>
      <View style={styles.body}>
        <Text style={[styles.sentence, { color: colors.ink }, struck && styles.struckText]}>
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
  // WI-054 — mirrors GroupCard's `archived: { opacity: 0.65 }` dimming
  // convention for an entity that is no longer "live".
  struckRow: {
    opacity: 0.65,
  },
  struckText: {
    textDecorationLine: 'line-through',
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
