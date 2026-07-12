import { StyleSheet, Text, View } from 'react-native';
import type { FriendDto } from '@divzy/shared';
import { Avatar, ListItem, MoneyText } from '@/components/ui';
import { balanceSentence } from '@/lib/format';
import { fontSize, useTheme } from '@/theme';

export interface FriendRowProps {
  friend: FriendDto;
  onPress: () => void;
}

/**
 * Friends-list row: avatar, name, balance sentence for the primary currency
 * and stacked per-currency amounts on the right.
 */
export function FriendRow({ friend, onPress }: FriendRowProps) {
  const { colors } = useTheme();
  const balances = friend.balances.filter((b) => b.amount !== 0);
  const primary = balances[0];

  const sentence = primary
    ? balanceSentence(friend.user.name, primary.amount, primary.currency)
    : `You and ${friend.user.name} are settled up`;
  const subtitle =
    balances.length > 1 ? `${sentence} · +${balances.length - 1} more` : sentence;

  return (
    <ListItem
      title={friend.user.name}
      subtitle={subtitle}
      leading={<Avatar name={friend.user.name} color={friend.user.avatarColor} size={40} />}
      onPress={onPress}
      chevron
      right={
        balances.length === 0 ? (
          <Text style={[styles.settled, { color: colors.ink3 }]}>settled</Text>
        ) : (
          <View style={styles.amounts}>
            {balances.slice(0, 2).map((b) => (
              <MoneyText
                key={b.currency}
                amount={b.amount}
                currency={b.currency}
                signed
                size={fontSize.sm}
              />
            ))}
            {balances.length > 2 ? (
              <Text style={[styles.more, { color: colors.ink3 }]}>+{balances.length - 2}</Text>
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
});
