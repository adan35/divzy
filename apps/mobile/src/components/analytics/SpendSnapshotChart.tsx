import { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, isValid, parseISO } from 'date-fns';
import { formatMoney } from '@divzy/shared';
import { EmptyState, ErrorState, MoneyText, Skeleton } from '@/components/ui';
import { errorMessage, useAnalytics } from '@/lib/hooks';
import { isSpendSnapshotEmpty, spendSnapshotRange } from '@/lib/spendSnapshot';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

export interface SpendSnapshotChartProps {
  style?: StyleProp<ViewStyle>;
}

const BAR_AREA_HEIGHT = 56;

function monthDate(month: string): Date | null {
  const parsed = parseISO(`${month}-01`);
  return isValid(parsed) ? parsed : null;
}

/**
 * WI-036 — self-fetching compact spend snapshot for the mobile dashboard's
 * chart slot: 3 bars (fixed 3-month window ending in the current month) of
 * `byMonth[].amount` ("your spend"), current month highlighted, plus a
 * "this month" headline. Own fetch/loading/error/empty states, isolated
 * from the rest of the dashboard (own query key, no threaded-in props —
 * contrast WI-039's props-driven ExpenseSplitChart). No client aggregation
 * or currency conversion: every value is read straight off
 * `AnalyticsSummaryDto` and formatted with `formatMoney(_, data.currency)`.
 *
 * Mounted in the host slot (`SpendChartSlot()` in
 * `apps/mobile/app/(tabs)/index.tsx`, notifications-activity-owned).
 */
export function SpendSnapshotChart({ style }: SpendSnapshotChartProps) {
  const { colors } = useTheme();
  const range = useMemo(() => spendSnapshotRange(), []);
  const query = useAnalytics(range);
  const data = query.data;

  const months = data?.byMonth ?? [];
  const currentIndex = months.length - 1;
  const maxMonth = months.reduce((acc, m) => Math.max(acc, m.amount), 0);
  const headline = currentIndex >= 0 ? months[currentIndex]!.amount : 0;
  const isEmpty = isSpendSnapshotEmpty(data);

  if (query.isLoading) {
    return (
      <View style={[styles.root, style]}>
        <Skeleton width={96} height={14} />
        <Skeleton width={120} height={26} style={styles.headlineSkeleton} />
        <Skeleton height={BAR_AREA_HEIGHT} radius={radii.md} />
      </View>
    );
  }

  if (query.isError || !data) {
    return (
      <View style={[styles.root, style]}>
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      </View>
    );
  }

  if (isEmpty) {
    return (
      <View style={[styles.root, style]}>
        <EmptyState emoji="📊" title="No spend yet" />
      </View>
    );
  }

  return (
    <View style={[styles.root, style]}>
      {data.usedFallbackRates ? (
        <View style={styles.fallbackRow}>
          <Ionicons name="information-circle" size={12} color={colors.warning} />
          <Text style={[styles.fallbackText, { color: colors.warning }]}>
            Offline exchange rates used
          </Text>
        </View>
      ) : null}

      <Text style={[styles.label, { color: colors.ink2 }]}>This month</Text>
      <MoneyText
        amount={headline}
        currency={data.currency}
        colored={false}
        size={fontSize.xxl}
        weight="600"
        style={styles.headline}
      />

      <View style={styles.barArea}>
        {months.map((item, index) => {
          const active = index === currentIndex;
          const height =
            maxMonth > 0 && item.amount > 0
              ? Math.max(4, Math.round((item.amount / maxMonth) * BAR_AREA_HEIGHT))
              : 2;
          const date = monthDate(item.month);
          const label = date ? format(date, 'MMM') : item.month.slice(5);
          return (
            <View key={item.month} style={styles.barColumn}>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.bar,
                    {
                      height,
                      // WI-068 §8.2 AC-9b — single-series marks consume
                      // chart1, not brand.
                      backgroundColor:
                        item.amount > 0
                          ? active
                            ? colors.chart1
                            : withAlpha(colors.chart1, 0.5)
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
                {label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.xs,
  },
  fallbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs / 2,
    marginBottom: spacing.xs,
  },
  fallbackText: {
    fontSize: 11,
    fontWeight: '500',
  },
  label: {
    fontSize: fontSize.xs,
  },
  headline: {
    marginBottom: spacing.sm,
  },
  headlineSkeleton: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  barArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
  },
  barTrack: {
    height: BAR_AREA_HEIGHT,
    justifyContent: 'flex-end',
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  bar: {
    width: '60%',
    maxWidth: 22,
    // WI-068 §8.2 — bars move 3px -> 4px rounded top.
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  barMonth: {
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  barMonthActive: {
    fontWeight: '600',
  },
});
