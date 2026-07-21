import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { computeFriendsSummary, type FriendDto } from '@divzy/shared';
import { Card, MoneyText } from '@/components/ui';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

export interface FriendsBalanceSummaryProps {
  /**
   * The FULL, unfiltered friends list (`data ?? []`) — never the WI-037
   * `filtered` array. The summary is deliberately filter-independent
   * (spec-WI-049 §2.2): changing the balance-direction filter must never
   * recompute these totals.
   */
  friends: readonly FriendDto[];
}

/**
 * WI-068 §9.2 — the pos-soft/neg-soft wash steps (mirrors `Badge`'s
 * `SOFT_ALPHA`, spec §1.1): mobile has no dedicated `posSoft`/`negSoft`
 * token, so call sites tint via `withAlpha` at the point of use (S1's
 * documented convention, same one `PulseHero`'s quick-action wash uses).
 */
const SOFT_ALPHA = { light: 0.08, dark: 0.12 } as const;

/**
 * WI-049 — accumulated "who owes what" card at the top of the Friends tab,
 * above the WI-037 `SegmentedControl` filter. Mirrors the web
 * `FriendsBalanceSummary` (same shared `computeFriendsSummary` helper, same
 * settled/unresolved/fallback semantics — spec-WI-049 §2/§3), restyled per
 * WI-068 §9.2 into a mini-Pulse chip strip: two pos-soft/neg-soft washed
 * chips (You are owed / You owe) instead of the plain two-column layout,
 * with the net line kept below.
 *
 * Renders nothing when `friends` is empty (spec §2.4 "Empty friends list");
 * the caller also guards on `friends.length > 0`, this is defense-in-depth.
 */
export function FriendsBalanceSummary({ friends }: FriendsBalanceSummaryProps) {
  const { colors, scheme } = useTheme();
  const summary = useMemo(() => computeFriendsSummary(friends), [friends]);

  if (friends.length === 0) return null;

  const settled = !summary.hasConvertible && !summary.hasUnresolved;
  // `summary.currency` is null only when no friend had a convertible figure;
  // in that state both totals are necessarily 0, so this fallback only picks
  // which currency symbol a "0" renders in — never the amount.
  const displayCurrency = summary.currency ?? summary.unresolvedCurrencies[0]?.currency ?? 'USD';
  const alpha = SOFT_ALPHA[scheme];

  return (
    <Card style={styles.card}>
      <View style={styles.chipsRow}>
        {/* "You are owed" chip — always a non-negative magnitude, so
            MoneyText's own default `colored` already renders `pos` when
            nonzero and the same muted `ink3` at 0 as before — no manual
            color override needed here. */}
        <View
          style={[
            styles.chip,
            {
              backgroundColor:
                summary.youAreOwed === 0 ? colors.surface2 : withAlpha(colors.pos, alpha),
            },
          ]}
        >
          <Text style={[styles.chipLabel, { color: colors.ink3 }]}>You are owed</Text>
          <MoneyText
            amount={summary.youAreOwed}
            currency={displayCurrency}
            size={fontSize.xl}
            weight="700"
          />
          {summary.youAreOwed === 0 ? (
            <Text style={[styles.chipCaption, { color: colors.ink3 }]}>
              {summary.hasUnresolved ? 'Some balances aren’t converted yet' : 'No one owes you'}
            </Text>
          ) : null}
        </View>

        {/* "You owe" chip — also always a non-negative magnitude, but must
            read as `neg` (red) when nonzero, so color is driven manually
            (MoneyText's automatic colored=true would otherwise read a
            positive magnitude as `pos`, which is wrong for this column). */}
        <View
          style={[
            styles.chip,
            {
              backgroundColor:
                summary.youOwe === 0 ? colors.surface2 : withAlpha(colors.neg, alpha),
            },
          ]}
        >
          <Text style={[styles.chipLabel, { color: colors.ink3 }]}>You owe</Text>
          <MoneyText
            amount={summary.youOwe}
            currency={displayCurrency}
            colored={false}
            size={fontSize.xl}
            weight="700"
            style={{ color: summary.youOwe === 0 ? colors.ink3 : colors.neg }}
          />
          {summary.youOwe === 0 ? (
            <Text style={[styles.chipCaption, { color: colors.ink3 }]}>
              {summary.hasUnresolved
                ? 'Some balances aren’t converted yet'
                : 'You don’t owe anyone'}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={[styles.netRow, { borderTopColor: colors.hairline }]}>
        {settled ? (
          <Text style={[styles.netSettled, { color: colors.ink }]}>All settled up 🎉</Text>
        ) : (
          <>
            <Text style={[styles.netLabel, { color: colors.ink3 }]}>Net</Text>
            <MoneyText amount={summary.net} currency={displayCurrency} signed size={fontSize.md} />
          </>
        )}
      </View>

      {summary.usedFallbackRates ? (
        <Text style={[styles.note, { color: colors.warning }]}>
          Some amounts use estimated exchange rates.
        </Text>
      ) : null}
      {summary.hasUnresolved ? (
        <Text style={[styles.note, { color: colors.ink3 }]}>
          Some balances aren’t converted yet.
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.lg,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chip: {
    flex: 1,
    minWidth: 0,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  chipLabel: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    letterSpacing: 0.2,
    marginBottom: spacing.xs,
  },
  chipCaption: {
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  netRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  netLabel: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  netSettled: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  note: {
    fontSize: fontSize.xs,
    marginTop: spacing.sm,
  },
});
