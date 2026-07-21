import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, TextInput, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { formatMoney } from '@divzy/shared';
import { easing, fontSize, motion, useTheme } from '@/theme';
import { formatTickerText, moneyTickerDescriptor } from '@/lib/motion';

Animated.addWhitelistedNativeProps({ text: true });
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

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
  /**
   * WI-068 §3 (additive): count up/down to a changed `amount` over ~600ms on
   * the reanimated UI thread. Default false — existing call sites render the
   * plain static Text exactly as before.
   */
  animate?: boolean;
  /** Also count up on first mount (Pulse hero passes true). Default false. */
  animateOnMount?: boolean;
  size?: number;
  weight?: TextStyle['fontWeight'];
  style?: StyleProp<TextStyle>;
}

export function MoneyText({
  amount,
  currency,
  signed = false,
  colored = true,
  animate = false,
  animateOnMount = false,
  size = fontSize.md,
  weight = '600',
  style,
}: MoneyTextProps) {
  const { colors } = useTheme();
  // Reduced motion (AC-8/AC-4c): the value snaps — we render the plain static
  // path so no animation frames are ever scheduled.
  const reduceMotion = useReducedMotion();

  // Semantic color comes from the FINAL value only — during a count the
  // figure never sweeps through green<->red (spec §3).
  const color = !colored
    ? colors.ink
    : amount > 0
      ? colors.pos
      : amount < 0
        ? colors.neg
        : colors.ink3;
  const finalText =
    signed && amount > 0 ? `+${formatMoney(amount, currency)}` : formatMoney(amount, currency);

  if (!animate || reduceMotion) {
    return (
      <Text style={[styles.money, { color, fontSize: size, fontWeight: weight }, style]}>
        {finalText}
      </Text>
    );
  }

  return (
    <AnimatedMoney
      amount={amount}
      currency={currency}
      signed={signed}
      animateOnMount={animateOnMount}
      finalText={finalText}
      textStyle={[styles.money, styles.ticker, { color, fontSize: size, fontWeight: weight }, style]}
    />
  );
}

interface AnimatedMoneyProps {
  amount: number;
  currency: string;
  signed: boolean;
  animateOnMount: boolean;
  finalText: string;
  textStyle: StyleProp<TextStyle>;
}

/**
 * The §3 mobile count-up: a shared value driven by
 * `withTiming(motion.count, easing.outExpo)`, rendered through the canonical
 * non-editable-TextInput + useAnimatedProps number-ticker pattern — every
 * frame is formatted ON the UI thread by the worklet-safe `formatTickerText`
 * (parity with `formatMoney` proven in lib/motion.test.ts), and the resting
 * frame is pinned to the exact `formatMoney` string. Separate component so
 * MoneyText's hook order stays stable when `animate`/reduced-motion flips.
 */
function AnimatedMoney({
  amount,
  currency,
  signed,
  animateOnMount,
  finalText,
  textStyle,
}: AnimatedMoneyProps) {
  const descriptor = useMemo(() => moneyTickerDescriptor(currency), [currency]);
  // On mount: start from 0 only when animateOnMount, else render final at once.
  const value = useSharedValue(animateOnMount ? 0 : amount);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      if (!animateOnMount) return; // already resting at `amount`
    }
    // On change, the shared value still holds the previous (or mid-flight)
    // figure — the count starts from there, per spec §3.
    value.value = withTiming(amount, { duration: motion.count, easing: easing.outExpo });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount]);

  const animatedProps = useAnimatedProps(() => {
    const frame = Math.round(value.value);
    const text =
      frame === amount
        ? finalText
        : `${signed && frame > 0 ? '+' : ''}${formatTickerText(frame, descriptor)}`;
    // `text` is a native TextInput prop (whitelisted above), absent from the
    // TS TextInputProps type — the canonical ReText-pattern cast.
    return { text } as unknown as Partial<import('react-native').TextInputProps>;
  });

  return (
    <AnimatedTextInput
      editable={false}
      focusable={false}
      pointerEvents="none"
      underlineColorAndroid="transparent"
      animatedProps={animatedProps}
      defaultValue={animateOnMount ? '' : finalText}
      // The accessible value is always the final figure, never a mid-count frame.
      accessibilityLabel={finalText}
      style={textStyle}
    />
  );
}

const styles = StyleSheet.create({
  money: {
    fontVariant: ['tabular-nums'],
  },
  // TextInput resets so the ticker occupies exactly the bounds a Text would.
  ticker: {
    margin: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
});
