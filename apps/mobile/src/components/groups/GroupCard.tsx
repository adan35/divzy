import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatMoney, type CurrencyAmount, type GroupSummaryDto } from '@divzy/shared';
import { Badge, Card } from '@/components/ui';
import { fontSize, radii, spacing, useTheme } from '@/theme';

/**
 * One display line per currency of the caller's net position in a group.
 * Positive = owed to you (pos tone), negative = you owe (neg tone).
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
}

export function GroupCard({ group, onPress, compact = false }: GroupCardProps) {
  const { colors } = useTheme();
  const lines = netLines(group.yourBalances);
  const archived = group.archivedAt !== null;

  if (compact) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Group ${group.name}`}
        onPress={onPress}
        style={({ pressed }) => [pressed && styles.pressed]}
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
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Group ${group.name}`}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed]}
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
            </View>
            <Text style={[styles.meta, { color: colors.ink3 }]}>
              {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
            </Text>
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
              </>
            )}
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.75,
  },
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
