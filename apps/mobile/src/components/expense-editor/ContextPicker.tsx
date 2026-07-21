import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FriendDto, GroupSummaryDto } from '@divzy/shared';
import { Avatar, SearchPicker, SegmentedControl, Skeleton } from '@/components/ui';
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
 * segmented Group | Friend plus a type-ahead search picker (WI-042) over the
 * active mode's already-fetched list.
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

  const renderPicker = () => {
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
      return (
        <SearchPicker<GroupSummaryDto>
          key="group"
          items={groups}
          value={selectedGroupId}
          onChange={onSelectGroup}
          getKey={(g) => g.id}
          getSearchText={(g) => g.name}
          modalTitle="Choose a group"
          searchPlaceholder="Search groups"
          fieldAccessibilityLabel={(selected) => `Group: ${selected?.name ?? 'none selected'}`}
          emptyLabel={() => 'No groups found'}
          renderFieldLabel={(selected) =>
            selected ? (
              <>
                <View style={[styles.emojiBubble, { backgroundColor: colors.surface2 }]}>
                  <Text style={styles.emoji}>{selected.emoji}</Text>
                </View>
                <View style={styles.fieldBody}>
                  <Text numberOfLines={1} style={[styles.fieldTitle, { color: colors.ink }]}>
                    {selected.name}
                  </Text>
                  <Text style={[styles.fieldSubtitle, { color: colors.ink3 }]}>
                    {selected.memberCount} {selected.memberCount === 1 ? 'member' : 'members'}
                  </Text>
                </View>
              </>
            ) : (
              <Text style={[styles.fieldPlaceholder, { color: colors.ink3 }]}>Choose a group</Text>
            )
          }
          renderRow={(group, active) => (
            <>
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
            </>
          )}
        />
      );
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
    return (
      <SearchPicker<FriendDto>
        key="friend"
        items={friends}
        value={selectedFriendId}
        onChange={onSelectFriend}
        getKey={(f) => f.user.id}
        getSearchText={(f) => f.user.name}
        modalTitle="Choose a friend"
        searchPlaceholder="Search friends"
        fieldAccessibilityLabel={(selected) => `Friend: ${selected?.user.name ?? 'none selected'}`}
        emptyLabel={() => 'No friends found'}
        renderFieldLabel={(selected) =>
          selected ? (
            <>
              <Avatar
                name={selected.user.name}
                color={selected.user.avatarColor}
                avatarUrl={selected.user.avatarUrl}
                size={28}
              />
              <View style={styles.fieldBody}>
                <Text numberOfLines={1} style={[styles.fieldTitle, { color: colors.ink }]}>
                  {selected.user.name}
                </Text>
              </View>
            </>
          ) : (
            <Text style={[styles.fieldPlaceholder, { color: colors.ink3 }]}>Choose a friend</Text>
          )
        }
        renderRow={(friend, active) => (
          <>
            <Avatar
              name={friend.user.name}
              color={friend.user.avatarColor}
              avatarUrl={friend.user.avatarUrl}
              size={36}
            />
            <View style={styles.rowBody}>
              <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.ink }]}>
                {friend.user.name}
              </Text>
            </View>
            {active ? <Ionicons name="checkmark-circle" size={22} color={colors.brand} /> : null}
          </>
        )}
      />
    );
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
      <View style={styles.list}>{renderPicker()}</View>
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
  fieldBody: {
    flex: 1,
    minWidth: 0,
    marginLeft: spacing.sm + 2,
  },
  fieldTitle: {
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  fieldSubtitle: {
    fontSize: fontSize.xs,
    marginTop: 1,
  },
  fieldPlaceholder: {
    fontSize: fontSize.md,
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
