import { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { format, isValid, parseISO, startOfMonth, subMonths } from 'date-fns';
import { categoryInfo, formatMoney } from '@divzy/shared';
import { Card, EmptyState, ErrorState, SegmentedControl, Skeleton } from '@/components/ui';
import { errorMessage, useAnalytics } from '@/lib/hooks';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

// Categorical chart palettes — fixed order, never cycled (STYLE.md §Charts).
const CHART_PALETTE_LIGHT = [
  '#2a78d6',
  '#1baf7a',
  '#eda100',
  '#008300',
  '#4a3aa7',
  '#e34948',
  '#e87ba4',
  '#eb6834',
] as const;
const CHART_PALETTE_DARK = [
  '#3987e5',
  '#199e70',
  '#c98500',
  '#008300',
  '#9085e9',
  '#e66767',
  '#d55181',
  '#d95926',
] as const;

type Period = '3m' | '6m' | '12m';
const PERIOD_MONTHS: Record<Period, number> = { '3m': 3, '6m': 6, '12m': 12 };

const BAR_AREA_HEIGHT = 132;

function monthDate(month: string): Date | null {
  const parsed = parseISO(`${month}-01`);
  return isValid(parsed) ? parsed : null;
}

/** Native analytics: stat tiles + View-built bar lists, no chart lib. */
export default function AnalyticsScreen() {
  const { colors, scheme } = useTheme();
  const router = useRouter();
  const [period, setPeriod] = useState<Period>('6m');
  const [activeBar, setActiveBar] = useState<number | null>(null);

  const range = useMemo(() => {
    const now = new Date();
    const from = startOfMonth(subMonths(now, PERIOD_MONTHS[period] - 1));
    return { from: from.toISOString(), to: now.toISOString() };
  }, [period]);

  const query = useAnalytics(range);
  const data = query.data;
  const palette = scheme === 'dark' ? CHART_PALETTE_DARK : CHART_PALETTE_LIGHT;

  // -- Derived chart data -------------------------------------------------------

  const months = data?.byMonth ?? [];
  const maxMonth = months.reduce((acc, m) => Math.max(acc, m.amount), 0);
  const activeIndex =
    activeBar !== null && activeBar < months.length ? activeBar : months.length - 1;

  const categories = useMemo(() => {
    if (!data) return [];
    const sorted = [...data.byCategory].sort((a, b) => b.amount - a.amount);
    if (sorted.length <= 8) return sorted.map((c, i) => ({ ...c, color: palette[i] ?? null }));
    const top = sorted.slice(0, 7).map((c, i) => ({ ...c, color: palette[i] ?? null }));
    const rest = sorted.slice(7).reduce((acc, c) => acc + c.amount, 0);
    return [...top, { category: 'OTHER' as const, amount: rest, color: null }];
  }, [data, palette]);
  const maxCategory = categories.reduce((acc, c) => Math.max(acc, c.amount), 0);

  const groups = useMemo(
    () => (data ? [...data.byGroup].sort((a, b) => b.amount - a.amount) : []),
    [data],
  );
  const maxGroup = groups.reduce((acc, g) => Math.max(acc, g.amount), 0);

  // -- Delta sentence (STYLE: down = green, up = secondary ink, never red) ------

  const delta = useMemo(() => {
    if (!data) return null;
    const prev = data.previousYourSpend;
    const curr = data.yourSpend;
    if (prev <= 0) {
      return curr > 0 ? { text: 'nothing spent last period', color: colors.ink3 } : null;
    }
    const pct = Math.round(((curr - prev) / prev) * 100);
    if (pct < 0) return { text: `↓ ${Math.abs(pct)}% vs last period`, color: colors.pos };
    if (pct > 0) return { text: `+${pct}% vs last period`, color: colors.ink2 };
    return { text: 'same as last period', color: colors.ink3 };
  }, [data, colors]);

  const isEmpty = !!data && data.yourSpend === 0 && data.totalActivity === 0;

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={[styles.root, { backgroundColor: colors.page }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => [
            styles.backButton,
            { backgroundColor: pressed ? colors.surface2 : 'transparent' },
          ]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.ink }]}>Analytics</Text>
      </View>

      <ScrollView
        style={styles.root}
        contentContainerStyle={[styles.gutters, styles.content]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor={colors.ink3}
          />
        }
      >
        <SegmentedControl
          options={[
            { value: '3m', label: '3 months' },
            { value: '6m', label: '6 months' },
            { value: '12m', label: '12 months' },
          ]}
          value={period}
          onChange={(next) => {
            setPeriod(next);
            setActiveBar(null);
          }}
        />

        {query.isLoading ? (
          <View style={styles.loadingBlocks}>
            <View style={styles.tileRow}>
              <Skeleton height={92} radius={radii.xl} style={styles.tileSkeleton} />
              <Skeleton height={92} radius={radii.xl} style={styles.tileSkeleton} />
            </View>
            <Skeleton height={190} radius={radii.xl} />
            <Skeleton height={220} radius={radii.xl} />
          </View>
        ) : query.isError || !data ? (
          <ErrorState
            message={errorMessage(query.error)}
            onRetry={() => void query.refetch()}
          />
        ) : isEmpty ? (
          <EmptyState
            emoji="📊"
            title="Nothing to chart yet"
            hint="Add a few expenses and your spending trends will show up here."
          />
        ) : (
          <>
            {data.usedFallbackRates ? (
              <View
                style={[styles.fallbackNote, { backgroundColor: withAlpha(colors.warning, 0.12) }]}
              >
                <Ionicons name="information-circle" size={16} color={colors.warning} />
                <Text style={[styles.fallbackText, { color: colors.warning }]}>
                  Some amounts were converted with offline exchange rates.
                </Text>
              </View>
            ) : null}

            {/* Hero tiles */}
            <View style={styles.tileRow}>
              <Card style={styles.tile}>
                <Text style={[styles.tileLabel, { color: colors.ink2 }]}>Your spend</Text>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={[styles.tileValue, { color: colors.ink }]}
                >
                  {formatMoney(data.yourSpend, data.currency)}
                </Text>
                {delta ? (
                  <Text style={[styles.tileDelta, { color: delta.color }]}>{delta.text}</Text>
                ) : null}
              </Card>
              <Card style={styles.tile}>
                <Text style={[styles.tileLabel, { color: colors.ink2 }]}>Total activity</Text>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  style={[styles.tileValue, { color: colors.ink }]}
                >
                  {formatMoney(data.totalActivity, data.currency)}
                </Text>
                <Text style={[styles.tileDelta, { color: colors.ink3 }]}>
                  everything you were part of
                </Text>
              </Card>
            </View>

            {/* Monthly bars */}
            <Card>
              <Text style={[styles.chartTitle, { color: colors.ink }]}>
                Your spend by month
              </Text>
              <View style={styles.barArea}>
                {months.map((item, index) => {
                  const active = index === activeIndex;
                  const height =
                    maxMonth > 0 && item.amount > 0
                      ? Math.max(4, Math.round((item.amount / maxMonth) * BAR_AREA_HEIGHT))
                      : 2;
                  const date = monthDate(item.month);
                  const initial = date ? format(date, 'MMM').charAt(0) : item.month.slice(5);
                  const fullLabel = date ? format(date, 'MMM') : item.month;
                  return (
                    <Pressable
                      key={item.month}
                      accessibilityRole="button"
                      accessibilityLabel={`${fullLabel}: ${formatMoney(item.amount, data.currency)}`}
                      onPress={() => {
                        Haptics.selectionAsync().catch(() => undefined);
                        setActiveBar(index);
                      }}
                      style={styles.barColumn}
                    >
                      {active ? (
                        <Text
                          numberOfLines={1}
                          style={[styles.barValue, { color: colors.ink }]}
                        >
                          {formatMoney(item.amount, data.currency)}
                        </Text>
                      ) : (
                        <View style={styles.barValuePlaceholder} />
                      )}
                      <View style={styles.barTrack}>
                        <View
                          style={[
                            styles.bar,
                            {
                              height,
                              backgroundColor:
                                item.amount > 0
                                  ? active
                                    ? colors.brand
                                    : withAlpha(colors.brand, 0.55)
                                  : colors.surface2,
                            },
                          ]}
                        />
                      </View>
                      <Text
                        style={[
                          styles.barMonth,
                          { color: active ? colors.ink : colors.ink3 },
                          active && styles.barMonthActive,
                        ]}
                      >
                        {active ? fullLabel : initial}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>

            {/* Category breakdown */}
            {categories.length > 0 ? (
              <Card>
                <Text style={[styles.chartTitle, { color: colors.ink }]}>By category</Text>
                <View style={styles.rowsBlock}>
                  {categories.map((row) => {
                    const info = categoryInfo(row.category);
                    const ratio = maxCategory > 0 ? row.amount / maxCategory : 0;
                    const barColor = row.color ?? colors.ink3;
                    return (
                      <View key={`${row.category}-${row.color ?? 'other'}`} style={styles.catRow}>
                        <Text style={styles.catEmoji}>{info.emoji}</Text>
                        <View style={styles.catBody}>
                          <View style={styles.catTopLine}>
                            <Text
                              numberOfLines={1}
                              style={[styles.catName, { color: colors.ink }]}
                            >
                              {row.color === null && row.category === 'OTHER'
                                ? 'Other'
                                : info.label}
                            </Text>
                            <Text style={[styles.catAmount, { color: colors.ink }]}>
                              {formatMoney(row.amount, data.currency)}
                            </Text>
                          </View>
                          <View
                            style={[styles.catBarTrack, { backgroundColor: colors.surface2 }]}
                          >
                            <View
                              style={[
                                styles.catBar,
                                {
                                  backgroundColor: barColor,
                                  width: `${Math.max(2, Math.round(ratio * 100))}%`,
                                },
                              ]}
                            />
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </Card>
            ) : null}

            {/* By group */}
            {groups.length > 0 ? (
              <Card>
                <Text style={[styles.chartTitle, { color: colors.ink }]}>By group</Text>
                <View style={styles.rowsBlock}>
                  {groups.map((group) => {
                    const ratio = maxGroup > 0 ? group.amount / maxGroup : 0;
                    return (
                      <View key={group.groupId} style={styles.catRow}>
                        <Text style={styles.catEmoji}>{group.emoji}</Text>
                        <View style={styles.catBody}>
                          <View style={styles.catTopLine}>
                            <Text
                              numberOfLines={1}
                              style={[styles.catName, { color: colors.ink }]}
                            >
                              {group.name}
                            </Text>
                            <Text style={[styles.catAmount, { color: colors.ink }]}>
                              {formatMoney(group.amount, data.currency)}
                            </Text>
                          </View>
                          <View
                            style={[styles.catBarTrack, { backgroundColor: colors.surface2 }]}
                          >
                            <View
                              style={[
                                styles.catBar,
                                {
                                  backgroundColor: withAlpha(colors.brand, 0.7),
                                  width: `${Math.max(2, Math.round(ratio * 100))}%`,
                                },
                              ]}
                            />
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  gutters: {
    paddingHorizontal: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.lg,
    fontWeight: '600',
    marginLeft: spacing.xs,
  },
  content: {
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  loadingBlocks: {
    gap: spacing.lg,
  },
  tileRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  tileSkeleton: {
    flex: 1,
  },
  tile: {
    flex: 1,
    minWidth: 0,
  },
  tileLabel: {
    fontSize: fontSize.sm,
  },
  tileValue: {
    fontSize: 28,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    marginTop: spacing.xs,
  },
  tileDelta: {
    fontSize: fontSize.xs,
    fontWeight: '500',
    marginTop: spacing.xs,
  },
  fallbackNote: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
  },
  fallbackText: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  chartTitle: {
    fontSize: fontSize.md,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  barArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
  },
  barValue: {
    fontSize: 10,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    marginBottom: spacing.xs,
  },
  barValuePlaceholder: {
    height: 12,
    marginBottom: spacing.xs,
  },
  barTrack: {
    height: BAR_AREA_HEIGHT,
    justifyContent: 'flex-end',
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  bar: {
    width: '68%',
    maxWidth: 28,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  barMonth: {
    fontSize: fontSize.xs,
    marginTop: spacing.xs + 2,
  },
  barMonthActive: {
    fontWeight: '600',
  },
  rowsBlock: {
    gap: spacing.md,
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  catEmoji: {
    fontSize: 18,
    width: 26,
    textAlign: 'center',
  },
  catBody: {
    flex: 1,
    minWidth: 0,
  },
  catTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  catName: {
    flex: 1,
    minWidth: 0,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  catAmount: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  catBarTrack: {
    height: 6,
    borderRadius: 3,
    marginTop: spacing.xs + 1,
    overflow: 'hidden',
  },
  catBar: {
    height: 6,
    borderRadius: 3,
  },
});
