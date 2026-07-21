import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { fontSize, radii, spacing, useTheme, withAlpha, type ColorScheme } from '@/theme';

export type BadgeTone = 'brand' | 'neutral' | 'pos' | 'neg' | 'danger' | 'warning' | 'accent';

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
}

/**
 * WI-068: wash alphas follow the spec §1.1 soft-token steps per scheme
 * (light washes are lighter than dark ones); `accent` (premium gold —
 * "settled" flourishes) consumes the accentSoft token directly.
 */
const SOFT_ALPHA: Record<Exclude<BadgeTone, 'neutral' | 'accent'>, Record<ColorScheme, number>> = {
  brand: { light: 0.09, dark: 0.14 },
  pos: { light: 0.08, dark: 0.12 },
  neg: { light: 0.08, dark: 0.12 },
  danger: { light: 0.08, dark: 0.12 },
  warning: { light: 0.1, dark: 0.12 },
};

export function Badge({ label, tone = 'neutral', style }: BadgeProps) {
  const { colors, scheme } = useTheme();
  const toneColor = {
    brand: colors.brand,
    neutral: colors.ink2,
    pos: colors.pos,
    neg: colors.neg,
    danger: colors.danger,
    warning: colors.warning,
    accent: colors.accent,
  }[tone];
  const background =
    tone === 'neutral'
      ? colors.surface2
      : tone === 'accent'
        ? colors.accentSoft
        : withAlpha(toneColor, SOFT_ALPHA[tone][scheme]);

  return (
    <View style={[styles.pill, { backgroundColor: background }, style]}>
      <Text numberOfLines={1} style={[styles.text, { color: toneColor }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  text: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
});
