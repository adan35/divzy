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
import { matchesBalanceFilter } from '@divzy/shared';
import {
  Card,
  EmptyState,
  ErrorState,
  PressableScale,
  Screen,
  SectionHeader,
  Skeleton,
  SkeletonList,
} from '@/components/ui';
import { GroupCard } from '@/components/groups/GroupCard';
import { ActivityRow } from '@/components/groups/ActivityRow';
import { SpendSnapshotChart } from '@/components/analytics/SpendSnapshotChart';
import { PulseHero } from '@/components/home/PulseHero';
import { ManualRatePromptDialog } from '@/components/settle/ManualRatePromptDialog';
import { useAuth } from '@/lib/auth';
import {
  errorMessage,
  useActivityInfinite,
  useGroups,
  useManualRatePrompt,
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

/**
 * WI-036 (notifications-activity slice) — layout slot for analytics' compact
 * spend chart. Per spec §2 this is a self-contained sibling section, never a
 * child/wrapper of the Recent Activity block below it: it takes no props
 * threaded from the activity preview, shares no query key/hook with
 * `useActivityInfinite`, and owns its own loading/error/empty states
 * internally so a chart failure can never break the rest of the dashboard
 * (independent failure domain). The bounded `maxHeight` below is a
 * placeholder value — analytics owns the final visual and may replace this
 * component's contents entirely; the height just must stay bounded and
 * independent of feed content so it can't push Recent Activity unpredictably
 * or reflow on data arrival.
 *
 * Hosts analytics' `SpendSnapshotChart` (self-fetching, self-contained —
 * see that component's own doc comment for its loading/error/empty states).
 * This slot owns placement only: the bounded, non-centered container below.
 */
function SpendChartSlot() {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.chartSlot,
        { backgroundColor: colors.surface, borderColor: colors.hairline },
      ]}
    >
      <SpendSnapshotChart style={styles.chartSlotContent} />
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
  const { colors, scheme } = useTheme();
  // spec §1.1 brand-soft: 0.09 alpha light / 0.14 dark (mobile has no
  // dedicated brandSoft token — soft washes are `withAlpha` at the call
  // site, per the S1 foundation's documented convention).
  const iconWash = withAlpha(colors.brand, scheme === 'light' ? 0.09 : 0.14);
  return (
    <PressableScale
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.quickAction, { backgroundColor: colors.surface, borderColor: colors.hairline }]}
    >
      <View style={[styles.quickIcon, { backgroundColor: iconWash }]}>
        <Ionicons name={icon} size={19} color={colors.brand} />
      </View>
      <Text numberOfLines={1} style={[styles.quickLabel, { color: colors.ink }]}>
        {label}
      </Text>
    </PressableScale>
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

  const converted = balanceQ.data?.converted;
  const { prompt: ratePrompt, dismiss: dismissRatePrompt } = useManualRatePrompt(
    converted?.unresolved ?? [],
    converted?.currency ?? null,
  );

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
  // spec-WI-057 — the GROUPS strip must show only groups with a real
  // outstanding balance for the viewer, not every active group. Evaluated
  // over `yourBalancesNative` (native, unconverted per-currency net) — never
  // `group.settled` (WI-028's group-WIDE flag: a group where the viewer is
  // settled but two other members owe each other is `settled: false`, which
  // would wrongly include it here) and never a converted figure (ARCH
  // invariant 5). `activeGroups` itself stays unfiltered — it still feeds
  // `isEmptyAccount` below, which must mean "no active groups at all", not
  // "no groups with a balance" (a user with only settled groups is not an
  // empty/onboarding account).
  const outstandingGroups = useMemo(
    () => activeGroups.filter((g) => matchesBalanceFilter(g.yourBalancesNative ?? [], 'outstanding')),
    [activeGroups],
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
            <View style={[styles.badge, { backgroundColor: colors.brandFill, borderColor: colors.page }]}>
              <Text style={[styles.badgeText, { color: colors.onBrand }]}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </Text>
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
          {/* spec-WI-068 §6 AC-6b: reserve the sparkline's own block too, so
              Pulse's content arriving doesn't shift layout (CLS-safe). */}
          <Skeleton height={64} radius={radii.md} style={styles.skeletonSparkline} />
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
              {/*
                spec-WI-068 §6 mobile — Divzy Pulse replaces this card's
                content (greeting block above stays untouched). Guarded on
                `balanceQ.data` directly (rather than a `converted!`
                assertion) so TS narrows `data.converted` etc. to defined —
                the balance query is neither loading nor erroring in this
                branch, so `data` is always present in practice.
              */}
              {balanceQ.data ? (
                <PulseHero
                  totals={balanceQ.data.totals}
                  youOwe={balanceQ.data.youOwe}
                  youAreOwed={balanceQ.data.youAreOwed}
                  converted={balanceQ.data.converted}
                  onSettle={() => router.push('/settle')}
                />
              ) : null}
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
          ) : outstandingGroups.length > 0 ? (
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
                {outstandingGroups.slice(0, 6).map((group) => (
                  <GroupCard
                    key={group.id}
                    group={group}
                    compact
                    onPress={() => router.push(`/group/${group.id}`)}
                  />
                ))}
              </ScrollView>
            </>
          ) : activeGroups.length > 0 ? (
            // spec-WI-057 — distinct from the onboarding empty state
            // (isEmptyAccount hero above): the viewer HAS active groups,
            // they're just all settled up. Still shows the section header +
            // "See all" so groups remain reachable.
            <>
              <SectionHeader
                title="GROUPS"
                actionLabel="See all"
                onAction={() => router.push('/(tabs)/groups')}
              />
              <Text style={[styles.groupsSettledNote, { color: colors.ink3 }]}>
                All settled up in your groups 🎉
              </Text>
            </>
          ) : null}

          {/*
            Spend chart slot (WI-036) — sibling section above Recent Activity,
            not a wrapper/child of it. Self-contained; independent of the
            feed's loading/error state (see SpendChartSlot doc comment).
            Gated behind !isEmptyAccount so it matches web's isBrandNew ternary:
            neither the chart nor Recent Activity renders on a brand-new account.
          */}
          {!isEmptyAccount && <SpendChartSlot />}

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
      <ManualRatePromptDialog prompt={ratePrompt} onClose={dismissRatePrompt} />
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
  groupsSettledNote: {
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  chartSlot: {
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
    maxHeight: 160,
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    padding: spacing.md,
  },
  chartSlotContent: {
    width: '100%',
  },
  skeletonHero: {
    marginTop: spacing.xs,
  },
  skeletonSparkline: {
    marginTop: spacing.md,
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
