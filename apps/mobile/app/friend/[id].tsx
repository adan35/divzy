import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatMoney, type FriendDto } from '@divzy/shared';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Screen,
  SectionHeader,
  Skeleton,
  SkeletonList,
} from '@/components/ui';
import { ExpenseSectionList } from '@/components/groups/ExpenseSectionList';
import { useAuth } from '@/lib/auth';
import { errorMessage, useFriends } from '@/lib/hooks';
import { fontSize, spacing, useTheme } from '@/theme';

function FriendHeader({ friend, meId }: { friend: FriendDto; meId: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const balances = friend.balances.filter((b) => b.amount !== 0);

  const openSettle = () => {
    const params: Record<string, string> = { friendId: friend.user.id };
    const primary = balances[0];
    if (primary) {
      params.amount = String(Math.abs(primary.amount));
      params.currency = primary.currency;
      if (primary.amount > 0) {
        params.fromUserId = friend.user.id;
        params.toUserId = meId;
      } else {
        params.fromUserId = meId;
        params.toUserId = friend.user.id;
      }
    } else {
      params.fromUserId = meId;
      params.toUserId = friend.user.id;
    }
    router.push({ pathname: '/settle', params });
  };

  return (
    <View>
      <Card style={styles.balanceCard}>
        {balances.length === 0 ? (
          <Text style={[styles.settled, { color: colors.ink }]}>
            You and {friend.user.name} are settled up 🎉
          </Text>
        ) : (
          balances.map((b) => (
            <View key={b.currency} style={styles.balanceLine}>
              <Text style={[styles.balanceSentence, { color: colors.ink }]}>
                {b.amount > 0 ? `${friend.user.name} owes you` : `You owe ${friend.user.name}`}
              </Text>
              <Text
                style={[
                  styles.balanceAmount,
                  { color: b.amount > 0 ? colors.pos : colors.neg },
                ]}
              >
                {formatMoney(Math.abs(b.amount), b.currency)}
              </Text>
            </View>
          ))
        )}
        <View style={styles.actions}>
          <Button
            title="Add expense"
            icon="add"
            onPress={() =>
              router.push({ pathname: '/expense/new', params: { friendId: friend.user.id } })
            }
            style={styles.actionButton}
          />
          <Button
            title="Settle up"
            icon="swap-horizontal"
            variant="secondary"
            onPress={openSettle}
            style={styles.actionButton}
          />
        </View>
      </Card>
      <SectionHeader title="SHARED EXPENSES" />
    </View>
  );
}

export default function FriendScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const friendId = typeof params.id === 'string' ? params.id : '';
  const router = useRouter();
  const { colors } = useTheme();
  const { user } = useAuth();

  const friendsQ = useFriends();
  const friend = friendsQ.data?.find((f) => f.user.id === friendId);
  const meId = user?.id ?? '';

  return (
    <Screen>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/friends'))}
          hitSlop={8}
          style={({ pressed }) => [
            styles.headerButton,
            { backgroundColor: pressed ? colors.surface2 : 'transparent' },
          ]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        {friend ? (
          <View style={styles.headerCenter}>
            <Avatar name={friend.user.name} color={friend.user.avatarColor} size={28} />
            <Text numberOfLines={1} style={[styles.headerTitle, { color: colors.ink }]}>
              {friend.user.name}
            </Text>
          </View>
        ) : (
          <View style={styles.headerCenter}>
            <Skeleton width={140} height={20} />
          </View>
        )}
        <View style={styles.headerButton} />
      </View>

      {friendsQ.isLoading ? (
        <SkeletonList rows={6} style={styles.skeleton} />
      ) : friendsQ.isError ? (
        <ErrorState
          message={errorMessage(friendsQ.error)}
          onRetry={() => void friendsQ.refetch()}
        />
      ) : !friend ? (
        <EmptyState
          emoji="👥"
          title="Friend not found"
          hint="This person isn't in your friends list anymore."
          actionLabel="Back to friends"
          onAction={() => router.replace('/(tabs)/friends')}
        />
      ) : (
        <ExpenseSectionList
          filters={{ friendId: friend.user.id }}
          currentUserId={meId}
          header={<FriendHeader friend={friend} meId={meId} />}
          emptyEmoji="🧾"
          emptyTitle="No shared expenses yet"
          emptyHint={`Expenses you split with ${friend.user.name} will show up here.`}
          emptyActionLabel="Add expense"
          onEmptyAction={() =>
            router.push({ pathname: '/expense/new', params: { friendId: friend.user.id } })
          }
        />
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
  headerCenter: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  headerTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginLeft: spacing.sm,
    flexShrink: 1,
  },
  skeleton: {
    marginTop: spacing.lg,
  },
  balanceCard: {
    marginTop: spacing.sm,
  },
  settled: {
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  balanceLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  balanceSentence: {
    fontSize: fontSize.md,
    flexShrink: 1,
    marginRight: spacing.md,
  },
  balanceAmount: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  actions: {
    flexDirection: 'row',
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
});
