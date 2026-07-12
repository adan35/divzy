import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radii, spacing, useTheme } from '@/theme';

export interface CardProps {
  children: ReactNode;
  /** Apply the default inner padding. Default true. */
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Card({ children, padded = true, style }: CardProps) {
  const { colors, scheme } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.hairline },
        scheme === 'light' && [styles.shadow, { shadowColor: colors.ink }],
        padded && styles.padded,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  padded: {
    padding: spacing.lg,
  },
  shadow: {
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
});
