import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { formatMoney, type ConvertedBalance, type CurrencyAmount } from '@divzy/shared';
import { Button, MoneyText, Skeleton } from '@/components/ui';
import { unresolvedNativeLines } from '@/lib/convertedBalance';
import { useAnalytics } from '@/lib/hooks';
import { pulseInsight } from '@/lib/pulseInsight';
import {
  pulseSparklineRange,
  shouldRenderSparkline,
  sparklineAreaPath,
  sparklineLinePath,
  sparklinePathLength,
  sparklinePoints,
} from '@/lib/pulseSparkline';
import { easing, fontSize, radii, spacing, useTheme } from '@/theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

// Fixed internal SVG coordinate space — the `<Svg>` scales to its container
// width via `width="100%"` + `preserveAspectRatio="none"`, so the sparkline
// math never needs an onLayout measurement pass (spec §6: CLS-safe, no
// reflow on data arrival).
const SPARK_W = 320;
const SPARK_H = 64;

function nonZero(amounts: readonly CurrencyAmount[]): CurrencyAmount[] {
  return amounts.filter((a) => a.amount !== 0);
}

/**
 * A balance column ("You owe" / "You are owed"): collapses per-currency
 * native amounts to a single converted figure (WI-001), with any currency
 * that couldn't auto-convert shown as a flagged, native-currency line
 * underneath — never dropped, zeroed, or silently misconverted (WI-002).
 * Moved here from `(tabs)/index.tsx` verbatim (byte-identical rendering
 * rules) — PulseHero now owns the hero card's full content, this column
 * included (spec-WI-068 §6 mobile placement).
 */
function AmountList({
  amounts,
  color,
  empty,
  converted,
  unresolved = [],
}: {
  amounts: CurrencyAmount[];
  color: string;
  empty: string;
  converted?: { amount: number; currency: string };
  unresolved?: CurrencyAmount[];
}) {
  const { colors } = useTheme();
  const list = nonZero(amounts);
  if (list.length === 0) {
    return <Text style={[styles.colEmpty, { color: colors.ink3 }]}>{empty}</Text>;
  }
  if (!converted) {
    return (
      <View>
        {list.map((a) => (
          <Text key={a.currency} style={[styles.colAmount, { color }]}>
            {formatMoney(a.amount, a.currency)}
          </Text>
        ))}
      </View>
    );
  }
  return (
    <View>
      <Text style={[styles.colAmount, { color }]}>
        {formatMoney(converted.amount, converted.currency)}
      </Text>
      {unresolved.map((u) => (
        <Text key={u.currency} style={[styles.colUnresolved, { color: colors.ink3 }]}>
          {formatMoney(u.amount, u.currency)} (unconverted)
        </Text>
      ))}
    </View>
  );
}

/**
 * The hand-rolled react-native-svg sparkline — "Your spend · last 6 months"
 * (spec §6: byMonth is the endpoint's finest granularity; a true 30-day
 * series would need a backend change, out of scope). Self-contained: skips
 * rendering below the dataviz 4-point floor (`shouldRenderSparkline`), and
 * gracefully draws the final state instantly under reduced motion.
 */
function Sparkline({ amounts }: { amounts: number[] }) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();

  const points = useMemo(() => sparklinePoints(amounts, SPARK_W, SPARK_H), [amounts]);
  const linePath = useMemo(() => sparklineLinePath(points), [points]);
  const areaPath = useMemo(() => sparklineAreaPath(points, SPARK_H), [points]);
  const length = useMemo(() => sparklinePathLength(points), [points]);

  const progress = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      progress.value = 1;
      return;
    }
    // spec §6 choreography: sparkline draws in via a 500ms stroke reveal
    // starting at +150ms (the count-up figure's own 600ms is the hero's
    // other concurrent animation — budget of 1-2 per view, spec §4).
    progress.value = withDelay(150, withTiming(1, { duration: 500, easing: easing.outExpo }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [length, reduceMotion]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: length * (1 - progress.value),
  }));

  if (!shouldRenderSparkline(amounts)) return null;

  return (
    <Svg
      width="100%"
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      preserveAspectRatio="none"
      accessibilityLabel="Your spend, last 6 months"
    >
      <Defs>
        <LinearGradient id="pulseSparklineFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.chart1} stopOpacity={0.18} />
          <Stop offset="1" stopColor={colors.chart1} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={areaPath} fill="url(#pulseSparklineFill)" />
      <AnimatedPath
        d={linePath}
        stroke={colors.chart1}
        strokeWidth={2}
        fill="none"
        strokeDasharray={[length, length]}
        animatedProps={animatedProps}
      />
    </Svg>
  );
}

function InsightLine({ text }: { text: string }) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 1;
      return;
    }
    // spec §6 choreography: insight fades in at +300ms/160ms.
    opacity.value = withDelay(300, withTiming(1, { duration: 160 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={animatedStyle}>
      <View style={styles.insightRow}>
        <Ionicons name="sparkles" size={14} color={colors.accent} style={styles.insightIcon} />
        <Text style={[styles.insightText, { color: colors.ink2 }]}>{text}</Text>
      </View>
    </Animated.View>
  );
}

export interface PulseHeroProps {
  /** Native per-currency totals (positive = the world owes you), UNFILTERED. */
  totals: CurrencyAmount[];
  /** Native per-currency amounts, UNFILTERED. */
  youOwe: CurrencyAmount[];
  youAreOwed: CurrencyAmount[];
  /** `GET /balance`'s `converted` block — always present on a successful response. */
  converted: ConvertedBalance;
  onSettle: () => void;
}

/**
 * Divzy Pulse — the dashboard's one hero animation (spec-WI-068 §6): an
 * animated net-position count-up, a 6-month spend sparkline, a deterministic
 * insight line, and a settle CTA. Replaces the pre-WI-068 hero `Card`'s
 * CONTENT in `(tabs)/index.tsx` — the greeting block above it and the
 * loading/error/onboarding states around it are untouched (those remain
 * `index.tsx`'s existing branches; this component only renders once balance
 * data is loaded, non-empty, and error-free).
 *
 * Self-fetches `GET /analytics/summary` for the sparkline's `byMonth` (own
 * query key, WI-067-cached) — independent of the balance fetch that already
 * lives in `index.tsx` for other purposes (onboarding detection, the manual
 * rate prompt). A slow/failed analytics fetch degrades gracefully: the
 * figure, suffix and base insight sentence render regardless (the
 * spend-delta clause simply doesn't append — `pulseInsight`'s own gating),
 * matching the WI-036 "chart is an independent failure domain" convention.
 */
export function PulseHero({ totals, youOwe, youAreOwed, converted, onSettle }: PulseHeroProps) {
  const { colors } = useTheme();

  const range = useMemo(() => pulseSparklineRange(), []);
  const analyticsQ = useAnalytics(range);
  const byMonth = analyticsQ.data?.byMonth ?? [];

  // WI-001 guard (story AC-6e): settled is derived from the NATIVE totals —
  // never `converted.total === 0`, which a currency excluded from
  // `converted.*` for lack of a rate could satisfy while still owing money.
  const settled = nonZero(totals).length === 0 && nonZero(youOwe).length === 0 && nonZero(youAreOwed).length === 0;

  const insightText = pulseInsight(
    settled,
    { total: converted.total, currency: converted.currency, unresolved: converted.unresolved },
    byMonth,
  );

  const youOweUnresolved = unresolvedNativeLines(youOwe, converted.unresolved);
  const youAreOwedUnresolved = unresolvedNativeLines(youAreOwed, converted.unresolved);

  const showSettle = !settled && (converted.total !== 0 || converted.unresolved.length > 0);

  // Only rendered in the non-settled branch below (the settled state has its
  // own "All settled" row) — `total === 0` here is the rare not-settled net-
  // zero edge case `pulseInsight` also handles (see its doc comment).
  const suffix = converted.total > 0 ? 'owed to you' : converted.total < 0 ? 'you owe' : 'net position';

  return (
    <View>
      <Text style={[styles.label, { color: colors.ink3 }]}>NET POSITION</Text>

      {settled ? (
        <View style={styles.settledRow}>
          <Ionicons name="checkmark-circle" size={30} color={colors.pos} />
          <Text style={[styles.settledText, { color: colors.ink }]}>All settled 🎉</Text>
        </View>
      ) : (
        <View style={styles.figureRow}>
          <MoneyText
            amount={converted.total}
            currency={converted.currency}
            animate
            animateOnMount
            size={fontSize.display}
            weight="700"
            style={styles.figure}
          />
          <Text style={[styles.suffix, { color: colors.ink3 }]}>{suffix}</Text>
        </View>
      )}

      {converted.usedFallbackRates ? (
        <Text style={[styles.fallbackNote, { color: colors.ink3 }]}>
          Some amounts use estimated exchange rates.
        </Text>
      ) : null}

      <InsightLine text={insightText} />

      {analyticsQ.isLoading ? (
        <Skeleton height={SPARK_H} radius={radii.md} style={styles.sparklineSkeleton} />
      ) : (
        <View style={styles.sparklineWrap}>
          <Sparkline amounts={byMonth.map((m) => m.amount)} />
        </View>
      )}

      <View style={[styles.divider, { backgroundColor: colors.hairline }]} />

      <View style={styles.columns}>
        <View style={styles.col}>
          <Text style={[styles.colLabel, { color: colors.ink3 }]}>You owe</Text>
          <AmountList
            amounts={youOwe}
            color={colors.neg}
            empty="Nothing 🎉"
            converted={{ amount: converted.youOwe, currency: converted.currency }}
            unresolved={youOweUnresolved}
          />
        </View>
        <View style={[styles.colSep, { backgroundColor: colors.hairline }]} />
        <View style={styles.col}>
          <Text style={[styles.colLabel, { color: colors.ink3 }]}>You are owed</Text>
          <AmountList
            amounts={youAreOwed}
            color={colors.pos}
            empty="Nothing yet"
            converted={{ amount: converted.youAreOwed, currency: converted.currency }}
            unresolved={youAreOwedUnresolved}
          />
        </View>
      </View>

      {showSettle ? (
        <Button
          title="Settle up"
          icon="arrow-forward"
          fullWidth
          style={styles.settleButton}
          onPress={onSettle}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  figureRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: spacing.sm,
    flexWrap: 'wrap',
  },
  figure: {
    marginRight: spacing.sm,
  },
  suffix: {
    fontSize: fontSize.sm,
  },
  settledRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  settledText: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  fallbackNote: {
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  insightIcon: {
    marginTop: 2,
  },
  insightText: {
    flex: 1,
    fontSize: fontSize.sm,
    lineHeight: 18,
  },
  sparklineWrap: {
    marginTop: spacing.md,
  },
  sparklineSkeleton: {
    marginTop: spacing.md,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.lg,
  },
  columns: {
    flexDirection: 'row',
  },
  col: {
    flex: 1,
  },
  colSep: {
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
  colUnresolved: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  settleButton: {
    marginTop: spacing.lg,
  },
});
