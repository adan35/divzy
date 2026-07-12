import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { FriendDto, GroupSummaryDto } from '@divzy/shared';
import { Avatar, SegmentedControl, Skeleton } from '@/components/ui';
import { fontSize, radii, spacing, useTheme } from '@/theme';

export type ContextMode = 'group' | 'friend';

export interface ContextPickerProps {
  mode: ContextMode;
  onModeChange: (mode: ContextMode) => void;
  /** Active (non-archived) groups. */
  groups: GroupSummaryDto[];
  friends: FriendDto[];
  groupsLoading: boolean;
  friendsLoading: boolean;
  selectedGroupId: string;
  selectedFriendId: string;
  onSelectGroup: (groupId: string) => void;
  onSelectFriend: (friendUserId: string) => void;
}

/**
 * "Share with" picker for expenses created outside a group/friend screen:
 * segmented Group | Friend plus a tappable list of choices.
 */
export function ContextPicker({
  mode,
  onModeChange,
  groups,
  friends,
  groupsLoading,
  friendsLoading,
  selectedGroupId,
  selectedFriendId,
  onSelectGroup,
  onSelectFriend,
}: ContextPickerProps) {
  const { colors } = useTheme();

  const select = (fn: () => void) => {
    Haptics.selectionAsync().catch(() => undefined);
    fn();
  };

  const renderRows = () => {
    if (mode === 'group') {
      if (groupsLoading) {
        return (
          <View style={styles.skeletons}>
            <Skeleton height={44} radius={radii.lg} />
            <Skeleton height={44} radius={radii.lg} />
          </View>
        );
      }
      if (groups.length === 0) {
        return (
          <Text style={[styles.emptyText, { color: colors.ink3 }]}>
            You are not in any groups yet — create one from the Groups tab, or split with a
            friend instead.
          </Text>
        );
      }
      return groups.map((group) => {
        const active = group.id === selectedGroupId;
        return (
          <Pressable
            key={group.id}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => select(() => onSelectGroup(group.id))}
            style={({ pressed }) => [
              styles.row,
              pressed && { backgroundColor: colors.surface2 },
            ]}
          >
            <View style={[styles.emojiBubble, { backgroundColor: colors.surface2 }]}>
              <Text style={styles.emoji}>{group.emoji}</Text>
            </View>
            <View style={styles.rowBody}>
              <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.ink }]}>
                {group.name}
              </Text>
              <Text style={[styles.rowSubtitle, { color: colors.ink3 }]}>
                {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
              </Text>
            </View>
            {active ? <Ionicons name="checkmark-circle" size={22} color={colors.brand} /> : null}
          </Pressable>
        );
      });
    }

    if (friendsLoading) {
      return (
        <View style={styles.skeletons}>
          <Skeleton height={44} radius={radii.lg} />
          <Skeleton height={44} radius={radii.lg} />
        </View>
      );
    }
    if (friends.length === 0) {
      return (
        <Text style={[styles.emptyText, { color: colors.ink3 }]}>
          You have not added any friends yet — add one from the Friends tab.
        </Text>
      );
    }
    return friends.map((friend) => {
      const active = friend.user.id === selectedFriendId;
      return (
        <Pressable
          key={friend.user.id}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          onPress={() => select(() => onSelectFriend(friend.user.id))}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface2 }]}
        >
          <Avatar name={friend.user.name} color={friend.user.avatarColor} size={36} />
          <View style={styles.rowBody}>
            <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.ink }]}>
              {friend.user.name}
            </Text>
          </View>
          {active ? <Ionicons name="checkmark-circle" size={22} color={colors.brand} /> : null}
        </Pressable>
      );
    });
  };

  return (
    <View style={[styles.card, { borderColor: colors.hairline, backgroundColor: colors.surface }]}>
      <Text style={[styles.title, { color: colors.ink2 }]}>Share this with</Text>
      <SegmentedControl
        options={[
          { value: 'group', label: 'Group' },
          { value: 'friend', label: 'Friend' },
        ]}
        value={mode}
        onChange={onModeChange}
      />
      <View style={styles.list}>{renderRows()}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radii.xl,
    padding: spacing.md,
    gap: spacing.sm + 2,
  },
  title: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  list: {
    gap: 2,
  },
  skeletons: {
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.sm,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  emojiBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 17,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  rowSubtitle: {
    fontSize: fontSize.xs,
    marginTop: 1,
  },
});
