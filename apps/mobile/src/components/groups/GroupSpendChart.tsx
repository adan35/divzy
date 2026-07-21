import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatMoney } from '@divzy/shared';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { errorMessage, useAnalytics } from '@/lib/hooks';
import { groupSpendBars, isGroupSpendEmpty } from '@/lib/groupSpendChart';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

export interface GroupSpendChartProps {
  style?: StyleProp<ViewStyle>;
}

const BAR_AREA_HEIGHT = 96;

/**
 * WI-060 — self-fetching "spend by group" chart for the Groups list header:
 * vertical bars laid out in a horizontal row (own `useAnalytics()` call, own
 * loading/error/empty state), deliberately distinct from the analytics
 * screen's horizontal progress-bar-row "By group" section
 * (`app/analytics.tsx:345-386`). Consumes `byGroup` verbatim — already
 * converted, zero-filtered and amount-desc sorted server-side — no
 * client-side re-aggregation or currency conversion (charter invariant 5).
 */
export function GroupSpendChart({ style }: GroupSpendChartProps) {
  const { colors } = useTheme();
  const query = useAnalytics();
  const data = query.data;

  const byGroup = data?.byGroup;
  const bars = groupSpendBars(byGroup ?? [], BAR_AREA_HEIGHT);
  const isEmpty = isGroupSpendEmpty(byGroup);

  if (query.isPending) {
    return (
      <Card style={style}>
        <Skeleton width={140} height={fontSize.md} style={styles.titleSkeleton} />
        <Skeleton height={BAR_AREA_HEIGHT + 40} radius={radii.md} />
      </Card>
    );
  }

  if (query.isError || !data) {
    return (
      <Card style={style}>
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      </Card>
    );
  }

  return (
    <Card style={style}>
      <Text style={[styles.title, { color: colors.ink }]}>Spend by group</Text>

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

      {isEmpty ? (
        <View style={styles.emptyArea}>
          <Text style={[styles.emptyTitle, { color: colors.ink2 }]}>No group spend yet</Text>
          <Text style={[styles.emptyHint, { color: colors.ink3 }]}>
            Add an expense in a group and it will show up here.
          </Text>
        </View>
      ) : (
        <View style={styles.barArea}>
          {bars.map((bar) => (
            <View key={bar.groupId} style={styles.barColumn}>
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={[styles.barAmount, { color: colors.ink }]}
              >
                {formatMoney(bar.amount, data.currency)}
              </Text>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: bar.height,
                      // WI-068 §8.2 AC-9b — single-series marks consume
                      // chart1, not brand (brand is reserved for interactive
                      // text/nav; chart1 is the validated series color).
                      backgroundColor: bar.isHighlight
                        ? colors.chart1
                        : withAlpha(colors.chart1, 0.35),
                    },
                  ]}
                />
              </View>
              <Text style={styles.barEmoji}>{bar.emoji}</Text>
              <Text
                numberOfLines={1}
                style={[styles.barName, { color: bar.isHighlight ? colors.ink : colors.ink3 }]}
              >
                {bar.name}
              </Text>
            </View>
          ))}
        </View>
      )}
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
  fallbackNote: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  fallbackText: {
    flex: 1,
    fontSize: fontSize.xs,
    fontWeight: '500',
  },
  emptyArea: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  emptyTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  emptyHint: {
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
    textAlign: 'center',
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
  barEmoji: {
    fontSize: 16,
    marginTop: spacing.xs + 2,
  },
  barName: {
    fontSize: fontSize.xs,
    marginTop: 2,
    maxWidth: 64,
    textAlign: 'center',
  },
});
