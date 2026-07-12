import { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import type { GroupDto } from '@divzy/shared';
import {
  AvatarStack,
  Badge,
  Button,
  ErrorState,
  Screen,
  SegmentedControl,
  Skeleton,
  SkeletonList,
} from '@/components/ui';
import { ExpenseSectionList } from '@/components/groups/ExpenseSectionList';
import { GroupBalancesTab } from '@/components/groups/GroupBalancesTab';
import { GroupTotalsTab } from '@/components/groups/GroupTotalsTab';
import { useAuth } from '@/lib/auth';
import { errorMessage, useGroup, useLeaveGroup } from '@/lib/hooks';
import { useGroupRoom } from '@/lib/socket';
import { fontSize, radii, spacing, useTheme } from '@/theme';

type GroupTab = 'expenses' | 'balances' | 'totals';

const TAB_OPTIONS = [
  { label: 'Expenses', value: 'expenses' },
  { label: 'Balances', value: 'balances' },
  { label: 'Totals', value: 'totals' },
] as const;

interface MenuProps {
  group: GroupDto;
  visible: boolean;
  onClose: () => void;
}

function GroupMenu({ group, visible, onClose }: MenuProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const leaveGroup = useLeaveGroup();

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
    try {
      await Clipboard.setStringAsync(inviteLink);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch {
      // Clipboard unavailable — ignore silently.
    }
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
    { key: 'leave', label: 'Leave group', icon: 'log-out-outline', danger: true, onPress: confirmLeave },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close menu"
        onPress={onClose}
        style={[styles.menuOverlay, { backgroundColor: colors.overlay }]}
      >
        <Pressable style={[styles.menuSheet, { backgroundColor: colors.surface }]}>
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

export default function GroupScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const groupId = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();
  const { colors } = useTheme();
  const { user } = useAuth();

  const groupQ = useGroup(groupId);
  useGroupRoom(groupId || undefined);

  const [tab, setTab] = useState<GroupTab>('expenses');
  const [menuOpen, setMenuOpen] = useState(false);

  const group = groupQ.data;
  const meId = user?.id ?? '';

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

          <GroupMenu group={group} visible={menuOpen} onClose={() => setMenuOpen(false)} />
        </>
      )}
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
