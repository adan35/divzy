import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { format, isValid, parseISO } from 'date-fns';
import { formatMoney } from '@divzy/shared';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { errorMessage, useAnalytics, useGroup } from '@/lib/hooks';
import { groupMonthlyBars, hasNonZeroMonth } from '@/lib/groupMonthlyChart';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

export interface GroupMonthlyChartProps {
  groupId: string;
  style?: StyleProp<ViewStyle>;
}

const BAR_AREA_HEIGHT = 96;

function monthLabel(month: string): string {
  const parsed = parseISO(`${month}-01`);
  return isValid(parsed) ? format(parsed, 'MMM') : month.slice(5);
}

/**
 * WI-059 — self-fetching "total expenditure by month" chart for the group
 * Totals tab: hand-rolled `View`/`Text` vertical bars in the established
 * `GroupSpendChart`/`ExpenseSplitChart` idiom (alpha-blended brand fills, no
 * charting dependency). Plots `byMonth[].totalActivity` — the group-wide
 * figure — NEVER `.amount` (the viewer's own converted share, D1). Resolves
 * `Group.currency` internally via `useGroup(groupId)` (React Query dedups
 * against the host screen's own `useGroup` call, D7) so the chart is one
 * shared group number, not the viewer's default currency (D3). Renders
 * nothing until there's at least one non-zero month (D6) — the host's own
 * empty-state guard covers the true "no expenses yet" case.
 */
export function GroupMonthlyChart({ groupId, style }: GroupMonthlyChartProps) {
  const { colors } = useTheme();
  const groupQuery = useGroup(groupId);
  const currency = groupQuery.data?.currency;
  const analyticsQuery = useAnalytics({ groupId, currency });
  const data = analyticsQuery.data;

  const isLoading = groupQuery.isLoading || analyticsQuery.isLoading;

  if (isLoading) {
    return (
      <Card style={style}>
        <Skeleton width={160} height={fontSize.md} style={styles.titleSkeleton} />
        <Skeleton height={BAR_AREA_HEIGHT + 40} radius={radii.md} />
      </Card>
    );
  }

  if (groupQuery.isError || analyticsQuery.isError || !data) {
    return (
      <Card style={style}>
        <ErrorState
          message={errorMessage(analyticsQuery.error ?? groupQuery.error)}
          onRetry={() => {
            void groupQuery.refetch();
            void analyticsQuery.refetch();
          }}
        />
      </Card>
    );
  }

  const byMonth = data.byMonth;
  if (!hasNonZeroMonth(byMonth)) return null;

  const bars = groupMonthlyBars(byMonth, BAR_AREA_HEIGHT);

  return (
    <Card style={style}>
      <Text style={[styles.title, { color: colors.ink }]}>Total spend by month</Text>
      <View style={styles.barArea}>
        {bars.map((bar) => (
          <View key={bar.month} style={styles.barColumn}>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[styles.barAmount, { color: colors.ink }]}
            >
              {formatMoney(bar.totalActivity, data.currency)}
            </Text>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.bar,
                  {
                    height: bar.height,
                    // WI-068 §8.2 AC-9b — single-series marks consume
                    // chart1, not brand.
                    backgroundColor:
                      bar.totalActivity > 0 ? withAlpha(colors.chart1, 0.55) : colors.surface2,
                  },
                ]}
              />
            </View>
            <Text style={[styles.barMonth, { color: colors.ink3 }]}>{monthLabel(bar.month)}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize.md,
    fontWeight: '600',
    marginBottom: spacing.md,
  },
  titleSkeleton: {
    marginBottom: spacing.md,
  },
  barArea: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    minWidth: 0,
  },
  barAmount: {
    fontSize: 10,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
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
    // WI-068 §8.2 — bars move 3/6px tops to the spec's 4px rounded top.
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  barMonth: {
    fontSize: fontSize.xs,
    marginTop: spacing.xs + 2,
  },
});
