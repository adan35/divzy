import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FriendDto } from '@divzy/shared';
import { Avatar, ListItem, MoneyText } from '@/components/ui';
import { balanceSentence } from '@/lib/format';
import { collapsedBalanceEntries } from '@/lib/convertedBalance';
import {
  BREAKDOWN_OVERFLOW_THRESHOLD,
  breakdownExpandable,
  visibleBreakdownRows,
} from '@/lib/friendGroupBreakdown';
import { fontSize, spacing, useTheme } from '@/theme';

export interface FriendRowProps {
  friend: FriendDto;
  onPress: () => void;
}

/**
 * Friends-list row: avatar, name, balance sentence and stacked amounts on
 * the right. Per spec-WI-001 (`GET /friends` addendum, 2026-07-14):
 * `balancesConverted` (if any) collapses to the one converted line, then any
 * `balances` leftovers (currencies with no resolvable rate) render as
 * additional native lines — mirrors web's `friends-preview.tsx` FriendRow.
 *
 * WI-079 (spec §5 D6–D12, §6.3): when the friend carries ≥2 per-group
 * buckets, a dedicated disclosure chevron (separate from the row's
 * navigation press, 44pt touch floor per WI-068) expands an inline
 * ledger-style breakdown — collapsed by default, one small-font line per
 * bucket with hairline separators, "Direct expenses" for the non-group
 * bucket, per-bucket `est. rate`, and a "+N more groups" in-expansion
 * toggle past 5 buckets. All row derivation lives in the pure
 * `@/lib/friendGroupBreakdown` module; this component only renders it.
 */
export function FriendRow({ friend, onPress }: FriendRowProps) {
  const { colors } = useTheme();
  // D6 — collapsed by default, per-row local state.
  const [expanded, setExpanded] = useState(false);
  const [showAllBuckets, setShowAllBuckets] = useState(false);
  const entries = collapsedBalanceEntries(friend.balancesConverted, friend.balances);
  const primary = entries[0];

  const sentence = primary
    ? balanceSentence(friend.user.name, primary.amount, primary.currency)
    : `You and ${friend.user.name} are settled up`;
  const subtitle = entries.length > 1 ? `${sentence} · +${entries.length - 1} more` : sentence;

  // D11 — affordance governed by bucket count, never the collapsed net.
  const expandable = breakdownExpandable(friend.balancesByGroup);
  const { rows, hiddenCount } = visibleBreakdownRows(
    friend.user.name,
    friend.balancesByGroup,
    showAllBuckets,
  );
  const hasOverflow = friend.balancesByGroup.length > BREAKDOWN_OVERFLOW_THRESHOLD;

  const amountsNode =
    entries.length === 0 ? (
      <Text style={[styles.settled, { color: colors.ink3 }]}>settled</Text>
    ) : (
      <View style={styles.amounts}>
        {entries.slice(0, 2).map((b) => (
          <MoneyText
            key={b.currency}
            amount={b.amount}
            currency={b.currency}
            signed
            size={fontSize.sm}
          />
        ))}
        {entries.length > 2 ? (
          <Text style={[styles.more, { color: colors.ink3 }]}>+{entries.length - 2}</Text>
        ) : null}
        {friend.usedFallbackRates ? (
          <Text style={[styles.fallback, { color: colors.warning }]} numberOfLines={1}>
            est. rate
          </Text>
        ) : null}
      </View>
    );

  return (
    <View>
      <ListItem
        title={friend.user.name}
        subtitle={subtitle}
        leading={
          <Avatar
            name={friend.user.name}
            color={friend.user.avatarColor}
            avatarUrl={friend.user.avatarUrl}
            size={40}
          />
        }
        onPress={onPress}
        chevron
        right={
          expandable ? (
            <View style={styles.rightRow}>
              {amountsNode}
              {/* D6 — dedicated chevron toggle; never an overloaded row tap.
                  Nested Pressable captures its own touch, so expanding can
                  never trigger the ListItem's navigation onPress. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Show per-group breakdown"
                accessibilityState={{ expanded }}
                onPress={() => setExpanded((v) => !v)}
                // WI-068 44pt touch floor: 20pt box + hitSlop 12.
                hitSlop={12}
                style={({ pressed }) => [
                  styles.disclosure,
                  pressed ? { backgroundColor: colors.surface2 } : null,
                ]}
              >
                <Ionicons
                  name={expanded ? 'chevron-down' : 'chevron-forward'}
                  size={16}
                  color={colors.ink3}
                />
              </Pressable>
            </View>
          ) : (
            amountsNode
          )
        }
      />
      {expanded && expandable ? (
        <View style={[styles.panel, { borderTopColor: colors.hairline }]}>
          {rows.map((row, index) => (
            <View
              key={row.key}
              style={[
                styles.bucketLine,
                index > 0
                  ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline }
                  : null,
              ]}
            >
              <View style={styles.bucketText}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.bucketLabel,
                    // D8 — direct bucket takes the secondary ink3 styling.
                    { color: row.direct ? colors.ink3 : colors.ink2 },
                  ]}
                >
                  {row.label}
                </Text>
                {row.caption ? (
                  <Text numberOfLines={1} style={[styles.bucketCaption, { color: colors.ink3 }]}>
                    {row.caption}
                  </Text>
                ) : null}
              </View>
              <View style={styles.amounts}>
                {row.entries.slice(0, 2).map((b) => (
                  <MoneyText
                    key={b.currency}
                    amount={b.amount}
                    currency={b.currency}
                    signed
                    size={fontSize.xs}
                  />
                ))}
                {row.entries.length > 2 ? (
                  <Text style={[styles.more, { color: colors.ink3 }]}>
                    +{row.entries.length - 2}
                  </Text>
                ) : null}
                {row.usedFallbackRates ? (
                  <Text style={[styles.fallback, { color: colors.warning }]} numberOfLines={1}>
                    est. rate
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
          {hasOverflow ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowAllBuckets((v) => !v)}
              hitSlop={8}
              style={[
                styles.overflowToggle,
                { borderTopColor: colors.hairline },
              ]}
            >
              <Text style={[styles.overflowText, { color: colors.brand }]}>
                {showAllBuckets ? 'Show less' : `+${hiddenCount} more groups`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  amounts: {
    alignItems: 'flex-end',
  },
  settled: {
    fontSize: fontSize.sm,
  },
  more: {
    fontSize: fontSize.xs,
  },
  fallback: {
    fontSize: fontSize.xs,
    marginTop: 1,
  },
  rightRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  disclosure: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.xs,
  },
  panel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginHorizontal: spacing.xs,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  bucketLine: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  bucketText: {
    flex: 1,
    minWidth: 0,
    marginRight: spacing.md,
  },
  bucketLabel: {
    fontSize: fontSize.sm,
  },
  bucketCaption: {
    fontSize: fontSize.xs,
    marginTop: 1,
  },
  overflowToggle: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.sm,
  },
  overflowText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
});
