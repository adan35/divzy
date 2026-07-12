import { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatMoney, type CurrencyAmount } from '@divzy/shared';
import {
  Card,
  EmptyState,
  ErrorState,
  Screen,
  SectionHeader,
  Skeleton,
  SkeletonList,
} from '@/components/ui';
import { GroupCard } from '@/components/groups/GroupCard';
import { ActivityRow } from '@/components/groups/ActivityRow';
import { useAuth } from '@/lib/auth';
import {
  errorMessage,
  useActivityInfinite,
  useGroups,
  useOverallBalance,
  useUnreadCount,
} from '@/lib/hooks';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

function greetingForNow(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function AmountList({ amounts, color, empty }: { amounts: CurrencyAmount[]; color: string; empty: string }) {
  const { colors } = useTheme();
  const nonZero = amounts.filter((a) => a.amount !== 0);
  if (nonZero.length === 0) {
    return <Text style={[styles.colEmpty, { color: colors.ink3 }]}>{empty}</Text>;
  }
  return (
    <View>
      {nonZero.map((a) => (
        <Text key={a.currency} style={[styles.colAmount, { color }]}>
          {formatMoney(a.amount, a.currency)}
        </Text>
      ))}
    </View>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickAction,
        { backgroundColor: colors.surface, borderColor: colors.hairline },
        pressed && { backgroundColor: colors.surface2 },
      ]}
    >
      <View style={[styles.quickIcon, { backgroundColor: withAlpha(colors.brand, 0.14) }]}>
        <Ionicons name={icon} size={19} color={colors.brand} />
      </View>
      <Text numberOfLines={1} style={[styles.quickLabel, { color: colors.ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function HomeTab() {
  const router = useRouter();
  const { colors } = useTheme();
  const { user } = useAuth();

  const balanceQ = useOverallBalance();
  const groupsQ = useGroups();
  const activityQ = useActivityInfinite(null);
  const unreadQ = useUnreadCount();

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        balanceQ.refetch(),
        groupsQ.refetch(),
        activityQ.refetch(),
        unreadQ.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const activeGroups = useMemo(
    () =>
      (groupsQ.data ?? [])
        .filter((g) => g.archivedAt === null)
        .sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '')),
    [groupsQ.data],
  );
  const recentActivity = activityQ.data?.pages[0]?.items.slice(0, 10) ?? [];
  const unreadCount = unreadQ.data?.count ?? 0;

  const initialLoading = balanceQ.isLoading || groupsQ.isLoading || activityQ.isLoading;
  const everythingFailed = balanceQ.isError && groupsQ.isError && activityQ.isError;
  const isEmptyAccount =
    !initialLoading &&
    !everythingFailed &&
    activeGroups.length === 0 &&
    recentActivity.length === 0;

  const totals = (balanceQ.data?.totals ?? []).filter((t) => t.amount !== 0);
  const firstName = user?.name.split(/\s+/)[0] ?? 'there';

  return (
    <Screen
      scroll
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
      }
    >
      {/* Greeting + notifications bell */}
      <View style={styles.headerRow}>
        <View style={styles.greetingBlock}>
          <Text style={[styles.greeting, { color: colors.ink3 }]}>{greetingForNow()},</Text>
          <Text numberOfLines={1} style={[styles.name, { color: colors.ink }]}>
            {firstName}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
          }
          onPress={() => router.push('/notifications')}
          style={({ pressed }) => [
            styles.bell,
            { backgroundColor: pressed ? colors.surface2 : colors.surface, borderColor: colors.hairline },
          ]}
        >
          <Ionicons name="notifications-outline" size={21} color={colors.ink} />
          {unreadCount > 0 ? (
            <View style={[styles.badge, { backgroundColor: colors.danger, borderColor: colors.page }]}>
              <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {everythingFailed ? (
        <ErrorState
          message={errorMessage(balanceQ.error)}
          onRetry={() => {
            void balanceQ.refetch();
            void groupsQ.refetch();
            void activityQ.refetch();
          }}
        />
      ) : initialLoading ? (
        <View>
          <Skeleton height={148} radius={radii.xl} style={styles.skeletonHero} />
          <View style={styles.skeletonActions}>
            <Skeleton height={72} radius={radii.xl} style={styles.skeletonAction} />
            <Skeleton height={72} radius={radii.xl} style={styles.skeletonAction} />
            <Skeleton height={72} radius={radii.xl} style={styles.skeletonActionLast} />
          </View>
          <SkeletonList rows={5} style={styles.skeletonList} />
        </View>
      ) : (
        <>
          {/* Hero balance card / onboarding */}
          {isEmptyAccount ? (
            <Card style={styles.heroCard}>
              <EmptyState
                emoji="👋"
                title="Welcome to Divzy!"
                hint="Create a group or add your first expense to start splitting fairly."
                actionLabel="Create a group"
                onAction={() => router.push('/group-form')}
                style={styles.onboarding}
              />
            </Card>
          ) : balanceQ.isError ? (
            <Card style={styles.heroCard}>
              <ErrorState
                message={errorMessage(balanceQ.error)}
                onRetry={() => void balanceQ.refetch()}
                style={styles.inlineError}
              />
            </Card>
          ) : (
            <Card style={styles.heroCard}>
              <Text style={[styles.heroLabel, { color: colors.ink2 }]}>Total balance</Text>
              {totals.length === 0 ? (
                <Text style={[styles.heroSettled, { color: colors.ink }]}>
                  You’re all settled up 🎉
                </Text>
              ) : (
                totals.map((t) => (
                  <View key={t.currency} style={styles.heroLine}>
                    <Text
                      style={[
                        styles.heroAmount,
                        { color: t.amount > 0 ? colors.pos : colors.neg },
                      ]}
                    >
                      {formatMoney(Math.abs(t.amount), t.currency)}
                    </Text>
                    <Text style={[styles.heroSuffix, { color: colors.ink3 }]}>
                      {t.amount > 0 ? 'owed to you' : 'you owe'}
                    </Text>
                  </View>
                ))
              )}
              <View style={[styles.heroDivider, { backgroundColor: colors.hairline }]} />
              <View style={styles.heroColumns}>
                <View style={styles.heroCol}>
                  <Text style={[styles.colLabel, { color: colors.ink3 }]}>You owe</Text>
                  <AmountList
                    amounts={balanceQ.data?.youOwe ?? []}
                    color={colors.neg}
                    empty="Nothing 🎉"
                  />
                </View>
                <View style={[styles.heroColSep, { backgroundColor: colors.hairline }]} />
                <View style={styles.heroCol}>
                  <Text style={[styles.colLabel, { color: colors.ink3 }]}>You are owed</Text>
                  <AmountList
                    amounts={balanceQ.data?.youAreOwed ?? []}
                    color={colors.pos}
                    empty="Nothing yet"
                  />
                </View>
              </View>
            </Card>
          )}

          {/* Quick actions */}
          <View style={styles.quickRow}>
            <QuickAction
              icon="add-circle-outline"
              label="Add expense"
              onPress={() => router.push('/expense/new')}
            />
            <QuickAction
              icon="swap-horizontal"
              label="Settle up"
              onPress={() => router.push('/settle')}
            />
            <QuickAction
              icon="people-outline"
              label="New group"
              onPress={() => router.push('/group-form')}
            />
          </View>

          {/* Groups preview */}
          {groupsQ.isError ? (
            <ErrorState
              message={errorMessage(groupsQ.error)}
              onRetry={() => void groupsQ.refetch()}
              style={styles.inlineError}
            />
          ) : activeGroups.length > 0 ? (
            <>
              <SectionHeader
                title="GROUPS"
                actionLabel="See all"
                onAction={() => router.push('/(tabs)/groups')}
              />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.groupsStrip}
              >
                {activeGroups.slice(0, 6).map((group) => (
                  <GroupCard
                    key={group.id}
                    group={group}
                    compact
                    onPress={() => router.push(`/group/${group.id}`)}
                  />
                ))}
              </ScrollView>
            </>
          ) : null}

          {/* Recent activity */}
          {activityQ.isError ? (
            <ErrorState
              message={errorMessage(activityQ.error)}
              onRetry={() => void activityQ.refetch()}
              style={styles.inlineError}
            />
          ) : recentActivity.length > 0 ? (
            <>
              <SectionHeader
                title="RECENT ACTIVITY"
                actionLabel="See all"
                onAction={() => router.push('/activity')}
              />
              <View>
                {recentActivity.map((activity) => (
                  <ActivityRow key={activity.id} activity={activity} currentUserId={user?.id} />
                ))}
              </View>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  greetingBlock: {
    flex: 1,
    minWidth: 0,
  },
  greeting: {
    fontSize: fontSize.sm,
  },
  name: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    marginTop: 1,
  },
  bell: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.md,
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  heroCard: {
    marginTop: spacing.xs,
  },
  onboarding: {
    paddingVertical: spacing.lg,
  },
  inlineError: {
    paddingVertical: spacing.xl,
  },
  heroLabel: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  heroSettled: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  heroLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: spacing.xs,
  },
  heroAmount: {
    fontSize: fontSize.hero,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  heroSuffix: {
    fontSize: fontSize.sm,
    marginLeft: spacing.sm,
  },
  heroDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.lg,
  },
  heroColumns: {
    flexDirection: 'row',
  },
  heroCol: {
    flex: 1,
  },
  heroColSep: {
    width: StyleSheet.hairlineWidth,
    marginHorizontal: spacing.lg,
  },
  colLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    letterSpacing: 0.2,
    marginBottom: spacing.xs,
  },
  colAmount: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    marginTop: 1,
  },
  colEmpty: {
    fontSize: fontSize.sm,
  },
  quickRow: {
    flexDirection: 'row',
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  quickAction: {
    flex: 1,
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  quickIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs + 2,
  },
  quickLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  groupsStrip: {
    paddingRight: spacing.lg,
  },
  skeletonHero: {
    marginTop: spacing.xs,
  },
  skeletonActions: {
    flexDirection: 'row',
    marginTop: spacing.lg,
  },
  skeletonAction: {
    flex: 1,
    marginRight: spacing.sm,
  },
  skeletonActionLast: {
    flex: 1,
  },
  skeletonList: {
    marginTop: spacing.xl,
  },
});
