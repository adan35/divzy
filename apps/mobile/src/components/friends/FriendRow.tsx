import { StyleSheet, Text, View } from 'react-native';
import type { FriendDto } from '@divzy/shared';
import { Avatar, ListItem, MoneyText } from '@/components/ui';
import { balanceSentence } from '@/lib/format';
import { collapsedBalanceEntries } from '@/lib/convertedBalance';
import { fontSize, useTheme } from '@/theme';

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
 */
export function FriendRow({ friend, onPress }: FriendRowProps) {
  const { colors } = useTheme();
  const entries = collapsedBalanceEntries(friend.balancesConverted, friend.balances);
  const primary = entries[0];

  const sentence = primary
    ? balanceSentence(friend.user.name, primary.amount, primary.currency)
    : `You and ${friend.user.name} are settled up`;
  const subtitle = entries.length > 1 ? `${sentence} · +${entries.length - 1} more` : sentence;

  return (
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
        )
      }
    />
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
});
