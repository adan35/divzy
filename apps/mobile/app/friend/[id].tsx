import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ApiError } from '@divzy/api-client';
import type { FriendDto } from '@divzy/shared';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorState,
  MoneyText,
  Screen,
  SectionHeader,
  Skeleton,
  SkeletonList,
} from '@/components/ui';
import { ExpenseSectionList } from '@/components/groups/ExpenseSectionList';
import { useAuth } from '@/lib/auth';
import { collapsedBalanceEntries } from '@/lib/convertedBalance';
import { errorMessage, useFriends, useRemoveFriend } from '@/lib/hooks';
import { friendHasNothingOutstanding, friendSettleParams } from '@/lib/settlements';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

// WI-068 §1.1 soft-wash steps (mirrors Badge's SOFT_ALPHA — mobile has no
// dedicated posSoft/negSoft token, so call sites tint via withAlpha).
const CHIP_ALPHA = { light: 0.08, dark: 0.12 } as const;

function FriendHeader({ friend, meId }: { friend: FriendDto; meId: string }) {
  const router = useRouter();
  const { colors, scheme } = useTheme();
  // Display: the one converted figure (if any) plus any currencies that had
  // no resolvable rate — spec-WI-001's rendering contract, identical to the
  // Friends list / Groups list.
  const displayEntries = collapsedBalanceEntries(friend.balancesConverted, friend.balances);

  // Prefill the settle screen: exact direction + amount when there's a
  // single outstanding NATIVE currency; otherwise just preselect the two of
  // you. Per spec-WI-001's `GET /friends` addendum (extending ADR-007 by
  // analogy) and spec-WI-050's fix, this must source from `balancesNative`
  // (the full signed native per-currency breakdown) — never `balances`
  // (WI-001-narrowed to unconvertible leftovers only, `[]` in the common
  // case — reading it made the ambiguous fallback fire in the majority case
  // and silently reverse direction) and never `balancesConverted` (a
  // displayed converted figure must never diverge from the amount actually
  // recorded in a Settlement row). See `friendSettleParams` (lib/settlements.ts).

  // WI-012 — zero-balance disable (client design · "Non-group entry
  // points"). Reads `balancesConverted` only as a boolean "is anything
  // outstanding at all", never to size a settlement — ARCH invariant 5
  // compliant. Visible-but-disabled, per the ADR-004 precedent (WI-004),
  // rather than hidden.
  const nothingOutstanding = friendHasNothingOutstanding(friend);

  const openSettle = () => {
    const params = friendSettleParams(friend.balancesNative, friend.user.id, meId);
    router.push({ pathname: '/settle', params });
  };

  return (
    <View>
      <Card style={styles.balanceCard}>
        {displayEntries.length === 0 ? (
          <Text style={[styles.settled, { color: colors.ink }]}>
            You and {friend.user.name} are settled up 🎉
          </Text>
        ) : (
          <>
            {/* WI-068 §9.2 — "friend detail balance chip header": each
                currency's net renders as a pos-soft/neg-soft washed chip
                (mirrors FriendsBalanceSummary's mini-Pulse strip) instead of
                a plain row. The signed MoneyText mirrors the friends-list
                FriendRow convention (sentence + native sign + color all
                agree — WI-055 "color is never the only signal"). */}
            {displayEntries.map((b) => (
              <View
                key={b.currency}
                style={[
                  styles.balanceChip,
                  {
                    backgroundColor: withAlpha(
                      b.amount > 0 ? colors.pos : colors.neg,
                      CHIP_ALPHA[scheme],
                    ),
                  },
                ]}
              >
                <Text style={[styles.balanceSentence, { color: colors.ink }]}>
                  {b.amount > 0 ? `${friend.user.name} owes you` : `You owe ${friend.user.name}`}
                </Text>
                <MoneyText
                  amount={b.amount}
                  currency={b.currency}
                  signed
                  size={fontSize.xl}
                  weight="700"
                />
              </View>
            ))}
            {friend.usedFallbackRates ? (
              <Text style={[styles.fallback, { color: colors.warning }]}>
                Uses estimated exchange rates
              </Text>
            ) : null}
          </>
        )}
        {/* WI-068 §9.2 — "settle CTA prominence when outstanding": Settle up
            becomes the primary (brandFill) action once there's a real
            balance to clear; Add expense yields to secondary. Settled up,
            Add expense stays primary since there's nothing to settle
            (WI-012's disabled gate on Settle up is unchanged either way). */}
        <View style={styles.actions}>
          <Button
            title="Add expense"
            icon="add"
            variant={nothingOutstanding ? 'primary' : 'secondary'}
            onPress={() =>
              router.push({ pathname: '/expense/new', params: { friendId: friend.user.id } })
            }
            style={styles.actionButton}
          />
          <Button
            title="Settle up"
            icon="swap-horizontal"
            variant={nothingOutstanding ? 'secondary' : 'primary'}
            onPress={openSettle}
            disabled={nothingOutstanding}
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
  const removeFriend = useRemoveFriend();

  // WI-066 — mirrors the group screen's confirmLeave/confirmDelete Alert
  // pattern. Copy deliberately avoids implying permanence: ensureFriendshipsAmong
  // will silently re-create the row if a shared group/expense/settlement
  // happens later, so this is "remove from your list", not a hard block.
  const confirmRemove = () => {
    if (!friend) return;
    Alert.alert(
      `Remove ${friend.user.name}?`,
      "They'll be removed from your friends list. Your shared history stays intact, and you can add them back anytime. You can only remove a friend once your balance with them is settled.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeFriend.mutate(friend.user.id, {
              onSuccess: () => {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
                  () => undefined,
                );
                router.replace('/(tabs)/friends');
              },
              onError: (err) => {
                if (err instanceof ApiError && err.code === 'OUTSTANDING_BALANCE') {
                  Alert.alert('Cannot remove friend', errorMessage(err));
                } else if (err instanceof ApiError && err.code === 'FRIENDSHIP_NOT_FOUND') {
                  // Already removed — same end state as a successful removal.
                  router.replace('/(tabs)/friends');
                } else {
                  Alert.alert('Something went wrong', errorMessage(err));
                }
              },
            });
          },
        },
      ],
    );
  };

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
            <Avatar
              name={friend.user.name}
              color={friend.user.avatarColor}
              avatarUrl={friend.user.avatarUrl}
              size={28}
            />
            <Text numberOfLines={1} style={[styles.headerTitle, { color: colors.ink }]}>
              {friend.user.name}
            </Text>
          </View>
        ) : (
          <View style={styles.headerCenter}>
            <Skeleton width={140} height={20} />
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Friend menu"
          onPress={confirmRemove}
          disabled={!friend}
          hitSlop={8}
          style={({ pressed }) => [
            styles.headerButton,
            { backgroundColor: pressed ? colors.surface2 : 'transparent' },
            !friend && styles.headerButtonDisabled,
          ]}
        >
          <Ionicons name="ellipsis-horizontal" size={22} color={colors.ink} />
        </Pressable>
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
  headerButtonDisabled: {
    opacity: 0.4,
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
  balanceChip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  fallback: {
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  balanceSentence: {
    fontSize: fontSize.md,
    flexShrink: 1,
    marginRight: spacing.md,
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
