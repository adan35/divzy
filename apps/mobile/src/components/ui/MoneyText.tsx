import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { formatMoney } from '@divzy/shared';
import { fontSize, useTheme } from '@/theme';

export interface MoneyTextProps {
  /** Integer minor units (signed). */
  amount: number;
  currency: string;
  /**
   * Prefix '+' on positive amounts so color is never the only signal.
   * Default false — list rows usually pair the amount with a sentence.
   */
  signed?: boolean;
  /** Color by sign: pos / neg / muted zero. Default true; false = ink. */
  colored?: boolean;
  size?: number;
  weight?: TextStyle['fontWeight'];
  style?: StyleProp<TextStyle>;
}

export function MoneyText({
  amount,
  currency,
  signed = false,
  colored = true,
  size = fontSize.md,
  weight = '600',
  style,
}: MoneyTextProps) {
  const { colors } = useTheme();
  const color = !colored
    ? colors.ink
    : amount > 0
      ? colors.pos
      : amount < 0
        ? colors.neg
        : colors.ink3;
  const text =
    signed && amount > 0 ? `+${formatMoney(amount, currency)}` : formatMoney(amount, currency);

  return (
    <Text style={[styles.money, { color, fontSize: size, fontWeight: weight }, style]}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  money: {
    fontVariant: ['tabular-nums'],
  },
});
