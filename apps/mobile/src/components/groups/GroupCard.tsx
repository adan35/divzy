import { StyleSheet, Text, View } from 'react-native';
import { formatMoney, type CurrencyAmount, type GroupSummaryDto } from '@divzy/shared';
import { Badge, Button, Card, PressableScale } from '@/components/ui';
import { collapsedBalanceEntries } from '@/lib/convertedBalance';
import { fontSize, radii, spacing, useTheme } from '@/theme';

/**
 * One display line per entry of the caller's net position in a group.
 * Positive = owed to you (pos tone), negative = you owe (neg tone). Callers
 * pass the already-collapsed entries (`collapsedBalanceEntries`) so this
 * only formats — it does not decide what converts (spec-WI-001).
 */
export function netLines(
  balances: CurrencyAmount[],
): Array<{ key: string; text: string; positive: boolean }> {
  return balances
    .filter((b) => b.amount !== 0)
    .map((b) => ({
      key: b.currency,
      positive: b.amount > 0,
      text:
        b.amount > 0
          ? `You are owed ${formatMoney(b.amount, b.currency)}`
          : `You owe ${formatMoney(-b.amount, b.currency)}`,
    }));
}

export interface GroupCardProps {
  group: GroupSummaryDto;
  onPress: () => void;
  /** Compact fixed-width card for the Home horizontal preview strip. */
  compact?: boolean;
  /**
   * WI-027 — shown only on archived rows. Un-gated here (GroupSummaryDto
   * carries no viewer-role field to check ADMIN client-side); the server's
   * `assertAdmin` guard is authoritative and a non-admin's tap surfaces its
   * 403 as a toast, same as any other action whose real enforcement is
   * server-side.
   */
  onUnarchive?: () => void;
  unarchiving?: boolean;
}

/**
 * Used by both mobile group-list surfaces (`(tabs)/groups.tsx`'s full list
 * and `(tabs)/index.tsx`'s Home preview strip). Per spec-WI-001:
 * `yourBalanceConverted` (if any) collapses to the one converted line, then
 * any `yourBalances` leftovers (currencies with no resolvable rate) render
 * as additional native lines — mirrors web's `groups/page.tsx` GroupCard /
 * `BalanceSentences` convention.
 */
export function GroupCard({
  group,
  onPress,
  compact = false,
  onUnarchive,
  unarchiving = false,
}: GroupCardProps) {
  const { colors } = useTheme();
  const entries = collapsedBalanceEntries(group.yourBalanceConverted, group.yourBalances);
  const lines = netLines(entries);
  const archived = group.archivedAt !== null;

  if (compact) {
    return (
      <PressableScale
        accessibilityLabel={`Group ${group.name}`}
        onPress={onPress}
      >
        <Card style={styles.compactCard}>
          <Text style={styles.compactEmoji}>{group.emoji}</Text>
          <Text numberOfLines={1} style={[styles.compactName, { color: colors.ink }]}>
            {group.name}
          </Text>
          <Text style={[styles.compactMeta, { color: colors.ink3 }]}>
            {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
          </Text>
          {lines.length > 0 ? (
            <Text
              numberOfLines={1}
              style={[
                styles.compactBalance,
                { color: lines[0]!.positive ? colors.pos : colors.neg },
              ]}
            >
              {lines[0]!.text}
            </Text>
          ) : (
            <Text style={[styles.compactBalance, { color: colors.ink3 }]}>Settled up</Text>
          )}
        </Card>
      </PressableScale>
    );
  }

  return (
    <PressableScale
      accessibilityLabel={`Group ${group.name}`}
      onPress={onPress}
    >
      <Card style={[styles.rowCard, archived && styles.archived]}>
        <View style={styles.row}>
          <View style={[styles.emojiBubble, { backgroundColor: colors.surface2 }]}>
            <Text style={styles.emoji}>{group.emoji}</Text>
          </View>
          <View style={styles.body}>
            <View style={styles.titleRow}>
              <Text numberOfLines={1} style={[styles.name, { color: colors.ink }]}>
                {group.name}
              </Text>
              {archived ? <Badge label="Archived" style={styles.archivedBadge} /> : null}
              {/* WI-028 — group-wide settled categorization (all members net
                  zero), independent of the archived state. */}
              {group.settled ? (
                <Badge label="Settled" tone="pos" style={styles.archivedBadge} />
              ) : null}
            </View>
            <Text style={[styles.meta, { color: colors.ink3 }]}>
              {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
            </Text>
            {archived && onUnarchive ? (
              <Button
                title="Unarchive"
                variant="secondary"
                size="sm"
                loading={unarchiving}
                onPress={onUnarchive}
                style={styles.unarchiveButton}
              />
            ) : null}
          </View>
          <View style={styles.balances}>
            {lines.length === 0 ? (
              <Text style={[styles.settled, { color: colors.ink3 }]}>Settled up</Text>
            ) : (
              <>
                {lines.slice(0, 2).map((line) => (
                  <Text
                    key={line.key}
                    numberOfLines={1}
                    style={[
                      styles.balanceLine,
                      { color: line.positive ? colors.pos : colors.neg },
                    ]}
                  >
                    {line.text}
                  </Text>
                ))}
                {lines.length > 2 ? (
                  <Text style={[styles.more, { color: colors.ink3 }]}>
                    +{lines.length - 2} more
                  </Text>
                ) : null}
                {group.usedFallbackRates ? (
                  <Text style={[styles.fallback, { color: colors.warning }]} numberOfLines={1}>
                    est. rate
                  </Text>
                ) : null}
              </>
            )}
          </View>
        </View>
      </Card>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  rowCard: {
    marginBottom: spacing.md,
  },
  archived: {
    opacity: 0.65,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  emojiBubble: {
    width: 44,
    height: 44,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  emoji: {
    fontSize: 22,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  name: {
    fontSize: fontSize.md,
    fontWeight: '600',
    flexShrink: 1,
  },
  archivedBadge: {
    marginLeft: spacing.sm,
  },
  meta: {
    fontSize: fontSize.sm,
    marginTop: 1,
  },
  unarchiveButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
  },
  balances: {
    marginLeft: spacing.md,
    alignItems: 'flex-end',
    maxWidth: '45%',
  },
  balanceLine: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  more: {
    fontSize: fontSize.xs,
    marginTop: 1,
  },
  fallback: {
    fontSize: fontSize.xs,
    marginTop: 1,
  },
  settled: {
    fontSize: fontSize.sm,
  },
  compactCard: {
    width: 172,
    marginRight: spacing.md,
  },
  compactEmoji: {
    fontSize: 28,
  },
  compactName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  compactMeta: {
    fontSize: fontSize.xs,
    marginTop: 1,
  },
  compactBalance: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    marginTop: spacing.sm,
    fontVariant: ['tabular-nums'],
  },
});
