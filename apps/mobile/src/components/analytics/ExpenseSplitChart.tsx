import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ExpenseSplitDto } from '@divzy/shared';
import { Avatar, MoneyText } from '@/components/ui';
import { computeSplitPercents } from '@/lib/expenseSplitPercents';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

export interface ExpenseSplitChartProps {
  /** expense.currency — NEVER expense.convertedCurrency (WI-014). */
  currency: string;
  /** expense.splits verbatim, one entry per participant. */
  splits: ExpenseSplitDto[];
  /** expense.amount — used only for the display-only percent labels. */
  totalAmount: number;
  /** Compared to split.user.id to label "You"; omit for plain names. */
  viewerUserId?: string;
  style?: StyleProp<ViewStyle>;
}

// Fixed segment fills — brand for the viewer's own share, a muted neutral
// scale for everyone else, matching the analytics screen's "no reinvented
// palette" convention (STYLE.md §Charts) without a per-user color mapping.
const SEGMENT_ALPHA = [0.85, 0.55, 0.4, 0.28, 0.2] as const;

/**
 * WI-039 — pure presentational, props-driven expense split breakdown: a
 * horizontal 100%-segmented bar, one segment per `splits` entry (2px gaps
 * between stacked segments, WI-068 §8.2). No fetch, no loading/error state
 * of its own (host's `useExpense` already gates mounting). Every amount is
 * `split.amount` rendered via `<MoneyText>` — never recomputed, converted,
 * or re-summed; percent labels are display-only (largest-remainder method,
 * see `computeSplitPercents`).
 */
export function ExpenseSplitChart({
  currency,
  splits,
  totalAmount,
  viewerUserId,
  style,
}: ExpenseSplitChartProps) {
  const { colors } = useTheme();
  const percents = computeSplitPercents(splits.map((s) => ({ amount: s.amount })));

  if (splits.length === 0) return null;

  return (
    <View style={style}>
      <View style={[styles.track, { backgroundColor: colors.surface2 }]}>
        {splits.map((split, index) => {
          const percent = percents ? percents[index]! : 0;
          const isLast = index === splits.length - 1;
          return (
            <View
              key={split.user.id}
              style={[
                styles.segment,
                {
                  flex: percents ? percent : 1,
                  backgroundColor: withAlpha(
                    colors.brand,
                    SEGMENT_ALPHA[index % SEGMENT_ALPHA.length]!,
                  ),
                },
                // WI-068 §8.2 — 2px surface gap between stacked segments.
                !isLast && { marginRight: 2 },
              ]}
            />
          );
        })}
      </View>

      <View style={styles.rows}>
        {splits.map((split, index) => {
          const isViewer = viewerUserId != null && split.user.id === viewerUserId;
          const percent = percents ? percents[index] : null;
          return (
            <View key={split.user.id} style={styles.row}>
              <Avatar
                name={split.user.name}
                color={split.user.avatarColor}
                avatarUrl={split.user.avatarUrl}
                size={24}
              />
              <Text numberOfLines={1} style={[styles.name, { color: colors.ink }]}>
                {isViewer ? 'You' : split.user.name}
              </Text>
              {percent !== null ? (
                <Text style={[styles.percent, { color: colors.ink3 }]}>{percent}%</Text>
              ) : null}
              <MoneyText
                amount={split.amount}
                currency={currency}
                colored={false}
                size={fontSize.sm}
                weight="600"
                style={styles.amount}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    height: 10,
    borderRadius: radii.sm,
    overflow: 'hidden',
  },
  segment: {
    height: '100%',
  },
  rows: {
    marginTop: spacing.md,
    gap: spacing.sm + 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    flex: 1,
    minWidth: 0,
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  percent: {
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  amount: {
    minWidth: 64,
    textAlign: 'right',
  },
});
