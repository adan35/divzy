import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

export type BadgeTone = 'brand' | 'neutral' | 'pos' | 'neg' | 'danger' | 'warning';

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
}

export function Badge({ label, tone = 'neutral', style }: BadgeProps) {
  const { colors } = useTheme();
  const toneColor = {
    brand: colors.brand,
    neutral: colors.ink2,
    pos: colors.pos,
    neg: colors.neg,
    danger: colors.danger,
    warning: colors.warning,
  }[tone];
  const background = tone === 'neutral' ? colors.surface2 : withAlpha(toneColor, 0.14);

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
