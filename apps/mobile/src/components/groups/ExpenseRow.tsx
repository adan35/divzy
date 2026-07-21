import { StyleSheet, Text, View } from 'react-native';
import { categoryInfo, formatMoney, type ExpenseDto } from '@divzy/shared';
import { ListItem } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { fontSize, useTheme } from '@/theme';

export interface ExpenseRowProps {
  expense: ExpenseDto;
  /** The signed lens ("you lent / you borrowed") is computed for this user. */
  currentUserId: string;
  onPress?: () => void;
}

/**
 * Expense list row: category emoji, description, "who paid" subtitle and a
 * you-lens amount on the right (paid − owed for the current user).
 */
export function ExpenseRow({ expense, currentUserId, onPress }: ExpenseRowProps) {
  const { colors } = useTheme();

  const myPaid = expense.payers
    .filter((p) => p.user.id === currentUserId)
    .reduce((acc, p) => acc + p.amount, 0);
  const myOwed = expense.splits
    .filter((s) => s.user.id === currentUserId)
    .reduce((acc, s) => acc + s.amount, 0);
  const involved =
    expense.payers.some((p) => p.user.id === currentUserId) ||
    expense.splits.some((s) => s.user.id === currentUserId);
  const lens = myPaid - myOwed;

  const firstPayer = expense.payers[0];
  const payerName = firstPayer
    ? firstPayer.user.id === currentUserId
      ? 'You'
      : firstPayer.user.name
    : 'Someone';
  const payerLabel =
    expense.payers.length > 1 ? `${payerName} +${expense.payers.length - 1}` : payerName;
  const subtitle = `${formatDate(expense.date)} · ${payerLabel} paid ${formatMoney(
    expense.amount,
    expense.currency,
  )}`;

  return (
    <ListItem
      title={expense.description}
      subtitle={subtitle}
      emoji={categoryInfo(expense.category).emoji}
      onPress={onPress}
      right={
        <View style={styles.rightColumn}>
          {expense.convertedAmount !== undefined ? (
            <View style={styles.convertedRow}>
              <Text style={[styles.convertedText, { color: colors.ink3 }]}>
                ≈ {formatMoney(expense.convertedAmount, expense.convertedCurrency!)}
              </Text>
              {expense.isApproximateRate ? (
                <Text
                  accessibilityLabel="Approximate — today's rate; the rate on this expense's date isn't available"
                  style={[styles.approxMarker, { color: colors.warning }]}
                >
                  *
                </Text>
              ) : null}
            </View>
          ) : null}
          {!involved ? (
            <Text style={[styles.lensLabel, { color: colors.ink3 }]}>not involved</Text>
          ) : lens === 0 ? (
            <Text style={[styles.lensLabel, { color: colors.ink3 }]}>settled</Text>
          ) : (
            <View style={styles.lens}>
              <Text
                style={[styles.lensLabel, { color: lens > 0 ? colors.pos : colors.neg }]}
              >
                {lens > 0 ? 'you lent' : 'you borrowed'}
              </Text>
              <Text
                style={[styles.lensAmount, { color: lens > 0 ? colors.pos : colors.neg }]}
              >
                {formatMoney(Math.abs(lens), expense.currency)}
              </Text>
              <Text style={[styles.lensCaption, { color: colors.ink3 }]}>at the time</Text>
            </View>
          )}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  rightColumn: {
    alignItems: 'flex-end',
  },
  convertedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  convertedText: {
    fontSize: fontSize.xs,
    fontVariant: ['tabular-nums'],
  },
  approxMarker: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    marginLeft: 2,
  },
  lens: {
    alignItems: 'flex-end',
  },
  lensLabel: {
    fontSize: fontSize.xs,
  },
  lensAmount: {
    fontSize: fontSize.md,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    marginTop: 1,
  },
  lensCaption: {
    fontSize: fontSize.xs,
    marginTop: 1,
  },
});
