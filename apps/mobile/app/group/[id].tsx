import { useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { ApiError } from '@divzy/api-client';
import type { FriendDto, GroupDto } from '@divzy/shared';
import {
  Avatar,
  AvatarStack,
  Badge,
  Button,
  ErrorState,
  Input,
  Screen,
  SegmentedControl,
  Skeleton,
  SkeletonList,
  Toast,
} from '@/components/ui';
import { ExpenseSectionList } from '@/components/groups/ExpenseSectionList';
import { GroupBalancesTab } from '@/components/groups/GroupBalancesTab';
import { GroupTotalsTab } from '@/components/groups/GroupTotalsTab';
import { useAuth } from '@/lib/auth';
import { copyInviteLink } from '@/lib/copyInvite';
import { friendsNotInGroup } from '@/lib/friendPicker';
import {
  errorMessage,
  useAddMemberByFriend,
  useDeleteGroup,
  useFriends,
  useGroup,
  useLeaveGroup,
  useUnarchiveGroup,
} from '@/lib/hooks';
import { filterBySearch } from '@/lib/searchFilter';
import { useGroupRoom } from '@/lib/socket';
import { nextToastTriggerId, type ToastTone } from '@/lib/toast';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

type GroupTab = 'expenses' | 'balances' | 'totals';

const TAB_OPTIONS = [
  { label: 'Expenses', value: 'expenses' },
  { label: 'Balances', value: 'balances' },
  { label: 'Totals', value: 'totals' },
] as const;

interface MenuProps {
  group: GroupDto;
  visible: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onCopyResult: (message: string, tone: ToastTone) => void;
  onOpenAddFriend: () => void;
}

function GroupMenu({ group, visible, isAdmin, onClose, onCopyResult, onOpenAddFriend }: MenuProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const leaveGroup = useLeaveGroup();
  const deleteGroup = useDeleteGroup();

  const inviteLink = `divzy://join/${group.inviteCode}`;
  const inviteMessage = `Join “${group.name}” on Divzy to split expenses with us! Invite code: ${group.inviteCode} — or open ${inviteLink}`;

  const shareInvite = async () => {
    onClose();
    try {
      await Share.share({ message: inviteMessage });
    } catch {
      // User dismissed the share sheet — nothing to do.
    }
  };

  const copyInvite = async () => {
    const result = await copyInviteLink(inviteLink, {
      setClipboardText: Clipboard.setStringAsync,
      notifySuccess: () =>
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
      onError: (err) => console.warn('[group-menu] copy invite link failed', err),
    });
    onCopyResult(result.message, result.tone);
    onClose();
  };

  const confirmLeave = () => {
    onClose();
    Alert.alert(
      'Leave group?',
      `You'll lose access to “${group.name}”. You can only leave once your balance is settled.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => {
            leaveGroup.mutate(group.id, {
              onSuccess: () => {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
                  () => undefined,
                );
                router.replace('/(tabs)/groups');
              },
              onError: (err) => {
                Alert.alert('Cannot leave group', errorMessage(err));
              },
            });
          },
        },
      ],
    );
  };

  // WI-046 — admin-only, mirrors confirmLeave's Alert pattern. Soft-delete is
  // terminal from the app's point of view (the group vanishes from every
  // read the mobile client can make), so the copy calls that out even though
  // the row survives soft-deleted server-side (ADR-WI-046-group-soft-delete).
  const confirmDelete = () => {
    onClose();
    Alert.alert(
      'Delete group?',
      `“${group.name}” will be permanently removed for everyone. This cannot be undone from the app. You can only delete once every balance is fully settled.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteGroup.mutate(group.id, {
              onSuccess: () => {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
                  () => undefined,
                );
                router.replace('/(tabs)/groups');
              },
              onError: (err) => {
                if (err instanceof ApiError && err.code === 'OUTSTANDING_BALANCE') {
                  Alert.alert(
                    'Not fully settled',
                    'This group must be fully settled before it can be deleted. Settle all balances, then try again.',
                  );
                } else {
                  Alert.alert('Cannot delete group', errorMessage(err));
                }
              },
            });
          },
        },
      ],
    );
  };

  const items: Array<{
    key: string;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    danger?: boolean;
    onPress: () => void;
  }> = [
    {
      key: 'edit',
      label: 'Edit group',
      icon: 'create-outline',
      onPress: () => {
        onClose();
        router.push({ pathname: '/group-form', params: { groupId: group.id } });
      },
    },
    { key: 'share', label: 'Invite via share sheet', icon: 'share-outline', onPress: () => void shareInvite() },
    { key: 'copy', label: 'Copy invite link', icon: 'copy-outline', onPress: () => void copyInvite() },
    {
      // WI-042 — additive to the existing add-by-email/invite-link paths, not
      // a replacement. Server enforces the friendship restriction (403
      // NOT_FRIENDS); the picker only offers friends, but is not the security
      // boundary.
      key: 'add-friend',
      label: 'Add from your friends',
      icon: 'person-add-outline',
      onPress: () => {
        onClose();
        onOpenAddFriend();
      },
    },
    { key: 'leave', label: 'Leave group', icon: 'log-out-outline', danger: true, onPress: confirmLeave },
    // WI-046 — client-side convenience gate only; the server's assertAdmin +
    // assertGroupSettled (409 OUTSTANDING_BALANCE) checks are authoritative
    // regardless of what this hides (same posture as the archive/unarchive
    // admin gate above).
    ...(isAdmin
      ? [
          {
            key: 'delete',
            label: 'Delete group',
            icon: 'trash-outline' as const,
            danger: true,
            onPress: confirmDelete,
          },
        ]
      : []),
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close menu"
        onPress={onClose}
        style={[styles.menuOverlay, { backgroundColor: colors.overlay }]}
      >
        {/* WI-068 §1.1 — a dropdown/popover-like surface consumes `elevated`,
            not `surface` (S1's classification for popovers/dialogs). */}
        <Pressable style={[styles.menuSheet, { backgroundColor: colors.elevated }]}>
          <Text style={[styles.menuTitle, { color: colors.ink3 }]} numberOfLines={1}>
            {group.emoji} {group.name}
          </Text>
          {items.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              onPress={item.onPress}
              style={({ pressed }) => [
                styles.menuItem,
                pressed && { backgroundColor: colors.surface2 },
              ]}
            >
              <Ionicons
                name={item.icon}
                size={20}
                color={item.danger ? colors.danger : colors.ink2}
              />
              <Text
                style={[styles.menuLabel, { color: item.danger ? colors.danger : colors.ink }]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
          <Button title="Cancel" variant="secondary" fullWidth onPress={onClose} style={styles.menuCancel} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

interface AddFriendToGroupPickerProps {
  group: GroupDto;
  visible: boolean;
  onClose: () => void;
  onResult: (message: string, tone: ToastTone) => void;
}

/**
 * WI-042 — picker of the caller's friends who aren't already active members
 * of this group. Additive to the existing add-by-email/invite-link paths;
 * the server enforces the friendship restriction (403 NOT_FRIENDS) — this
 * picker only narrows the offered list, it is not the security boundary.
 */
function AddFriendToGroupPicker({
  group,
  visible,
  onClose,
  onResult,
}: AddFriendToGroupPickerProps) {
  const { colors } = useTheme();
  const friendsQ = useFriends();
  const addMemberByFriend = useAddMemberByFriend();
  const [query, setQuery] = useState('');
  const candidates = filterBySearch(
    friendsNotInGroup(friendsQ.data ?? [], group),
    query,
    (f) => f.user.name,
  );

  const select = (friend: FriendDto) => {
    addMemberByFriend.mutate(
      { groupId: group.id, input: { userId: friend.user.id } },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
            () => undefined,
          );
          onResult(`${friend.user.name} added to ${group.name}`, 'success');
          setQuery('');
          onClose();
        },
        onError: (err) => {
          onResult(errorMessage(err), 'error');
        },
      },
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView
        edges={['top', 'left', 'right', 'bottom']}
        style={[styles.pickerRoot, { backgroundColor: colors.page }]}
      >
        <View style={styles.pickerHeader}>
          <Text style={[styles.menuTitle, { color: colors.ink }]}>Add from your friends</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            hitSlop={8}
          >
            <Ionicons name="close" size={22} color={colors.ink2} />
          </Pressable>
        </View>
        <Input
          placeholder="Search friends"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          containerStyle={styles.pickerSearch}
        />
        <FlatList
          data={candidates}
          keyExtractor={(f) => f.user.id}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => (
            <View style={[styles.separator, { backgroundColor: colors.hairline }]} />
          )}
          ListEmptyComponent={
            <Text style={[styles.pickerEmpty, { color: colors.ink3 }]}>
              {query.trim()
                ? 'No friends match your search.'
                : 'All your friends are already in this group.'}
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => select(item)}
              disabled={addMemberByFriend.isPending}
              style={({ pressed }) => [
                styles.menuItem,
                pressed && { backgroundColor: colors.surface2 },
              ]}
            >
              <Avatar
                name={item.user.name}
                color={item.user.avatarColor}
                avatarUrl={item.user.avatarUrl}
                size={32}
              />
              <Text style={[styles.menuLabel, { color: colors.ink }]}>{item.user.name}</Text>
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

export default function GroupScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();
  const { colors } = useTheme();
  const { user } = useAuth();

  const groupQ = useGroup(groupId);
  useGroupRoom(groupId || undefined);
  const unarchiveGroup = useUnarchiveGroup();

  const [tab, setTab] = useState<GroupTab>('expenses');
  const [menuOpen, setMenuOpen] = useState(false);
  const [addFriendOpen, setAddFriendOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: ToastTone; id: number } | null>(
    null,
  );
  const toastSeq = useRef(0);
  const showToast = (message: string, tone: ToastTone) => {
    toastSeq.current = nextToastTriggerId(toastSeq.current);
    setToast({ message, tone, id: toastSeq.current });
  };

  const group = groupQ.data;
  const meId = user?.id ?? '';
  // WI-027 — mirrors the server's `assertAdmin` gate (UI-only convenience;
  // the server guard is authoritative regardless of what this hides).
  const isAdmin = group?.members.find((m) => m.user.id === meId)?.role === 'ADMIN';

  const unarchive = () => {
    if (!group) return;
    unarchiveGroup.mutate(group.id, {
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        showToast(`${group.name} restored`, 'success');
      },
      onError: (err) => showToast(errorMessage(err), 'error'),
    });
  };

  return (
    <Screen>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/groups'))}
          hitSlop={8}
          style={({ pressed }) => [
            styles.headerButton,
            { backgroundColor: pressed ? colors.surface2 : 'transparent' },
          ]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        {group ? (
          <View style={styles.headerCenter}>
            <Text numberOfLines={1} style={[styles.headerTitle, { color: colors.ink }]}>
              {group.emoji} {group.name}
            </Text>
          </View>
        ) : (
          <View style={styles.headerCenter}>
            <Skeleton width={160} height={20} />
          </View>
        )}
        {/*
          Persistent "Settle Up" entry point (spec-WI-003) — sits above the
          segmented control, so it stays visible on every segment
          (expenses/balances/totals), not just the Balances tab's own
          "Record a payment" button. Navigates to the existing /settle route
          scoped to this group only, no prefill — same pattern
          GroupBalancesTab's "Record" button uses, minus the prefill params.
          No archived-conditional rendering, matching the ellipsis menu's
          existing unconditional rendering (ADR-free — same-domain UI wiring).
        */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settle up"
          onPress={() =>
            group && router.push({ pathname: '/settle', params: { groupId: group.id } })
          }
          disabled={!group}
          hitSlop={8}
          style={({ pressed }) => [
            styles.headerButton,
            { backgroundColor: pressed ? colors.surface2 : 'transparent' },
            !group && styles.headerButtonDisabled,
          ]}
        >
          <Ionicons name="cash-outline" size={22} color={colors.ink} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Group menu"
          onPress={() => setMenuOpen(true)}
          disabled={!group}
          hitSlop={8}
          style={({ pressed }) => [
            styles.headerButton,
            { backgroundColor: pressed ? colors.surface2 : 'transparent' },
            !group && styles.headerButtonDisabled,
          ]}
        >
          <Ionicons name="ellipsis-horizontal" size={22} color={colors.ink} />
        </Pressable>
      </View>

      {groupQ.isLoading ? (
        <SkeletonList rows={7} style={styles.skeleton} />
      ) : groupQ.isError || !group ? (
        <ErrorState message={errorMessage(groupQ.error)} onRetry={() => void groupQ.refetch()} />
      ) : (
        <>
          {/* WI-027 — archived banner + reverse-of-archive action (ADMIN-only,
              mirrors the server's assertAdmin gate; server is authoritative). */}
          {group.archivedAt ? (
            <View style={[styles.archivedBanner, { backgroundColor: withAlpha(colors.ink3, 0.12) }]}>
              <Text style={[styles.archivedBannerText, { color: colors.ink2 }]}>
                This group is archived.
              </Text>
              {isAdmin ? (
                <Button
                  title="Unarchive"
                  variant="secondary"
                  size="sm"
                  loading={unarchiveGroup.isPending}
                  onPress={unarchive}
                />
              ) : null}
            </View>
          ) : null}

          {/* Members */}
          <View style={styles.membersRow}>
            <AvatarStack users={group.members.map((m) => m.user)} size={28} max={5} />
            <Text style={[styles.membersText, { color: colors.ink3 }]}>
              {group.members.length} {group.members.length === 1 ? 'member' : 'members'}
            </Text>
            {group.archivedAt ? <Badge label="Archived" style={styles.archivedBadge} /> : null}
            <View style={styles.membersSpacer} />
            <Button
              title="Add"
              icon="add"
              size="sm"
              variant="secondary"
              onPress={() => router.push({ pathname: '/expense/new', params: { groupId: group.id } })}
            />
          </View>

          <SegmentedControl<GroupTab>
            options={TAB_OPTIONS}
            value={tab}
            onChange={setTab}
            style={styles.tabs}
          />

          <View style={styles.tabContent}>
            {tab === 'expenses' ? (
              <ExpenseSectionList
                filters={{ groupId: group.id }}
                currentUserId={meId}
                emptyEmoji="🧾"
                emptyTitle="No expenses yet"
                emptyHint="Add the first expense and Divzy keeps the math fair."
                emptyActionLabel="Add expense"
                onEmptyAction={() =>
                  router.push({ pathname: '/expense/new', params: { groupId: group.id } })
                }
              />
            ) : tab === 'balances' ? (
              <GroupBalancesTab
                groupId={group.id}
                simplifyDebts={group.simplifyDebts}
                currentUserId={meId}
              />
            ) : (
              <GroupTotalsTab groupId={group.id} currentUserId={meId} />
            )}
          </View>

          <GroupMenu
            group={group}
            visible={menuOpen}
            isAdmin={isAdmin}
            onClose={() => setMenuOpen(false)}
            onCopyResult={showToast}
            onOpenAddFriend={() => setAddFriendOpen(true)}
          />
          <AddFriendToGroupPicker
            group={group}
            visible={addFriendOpen}
            onClose={() => setAddFriendOpen(false)}
            onResult={showToast}
          />
        </>
      )}
      {toast ? <Toast message={toast.message} tone={toast.tone} triggerId={toast.id} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonDisabled: {
    opacity: 0.4,
  },
  headerCenter: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  headerTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  skeleton: {
    marginTop: spacing.lg,
  },
  membersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  membersText: {
    fontSize: fontSize.sm,
    marginLeft: spacing.sm,
  },
  archivedBadge: {
    marginLeft: spacing.sm,
  },
  membersSpacer: {
    flex: 1,
  },
  archivedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  archivedBannerText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    flex: 1,
    marginRight: spacing.md,
  },
  pickerRoot: {
    flex: 1,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  pickerSearch: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  pickerEmpty: {
    textAlign: 'center',
    fontSize: fontSize.sm,
    paddingVertical: spacing.xl,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.lg,
  },
  tabs: {
    marginTop: spacing.sm,
  },
  tabContent: {
    flex: 1,
    marginTop: spacing.xs,
  },
  menuOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  menuSheet: {
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  menuTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
  },
  menuLabel: {
    fontSize: fontSize.md,
    fontWeight: '500',
    marginLeft: spacing.md,
  },
  menuCancel: {
    marginTop: spacing.md,
  },
});
