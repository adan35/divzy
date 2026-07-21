import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radii, spacing, topEdgeHighlight, useTheme } from '@/theme';

export interface CardProps {
  children: ReactNode;
  /** Apply the default inner padding. Default true. */
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * WI-068 card tier (spec §1.1): light mode wears the resting shadow-1
 * (0 1px 2px @ 5%, slate-tinted); dark mode uses NO shadow — hairline border
 * plus a 1px machined top-edge highlight (rgba(255,255,255,0.04)) inside the
 * radius, per the "borders + top edge, not shadows" dark-elevation rule.
 */
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
      {scheme === 'dark' ? (
        <View pointerEvents="none" style={[styles.topEdge, { backgroundColor: topEdgeHighlight }]} />
      ) : null}
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
  // shadow-1: resting card shadow, light scheme only (spec §1.1).
  shadow: {
    shadowOpacity: 0.05,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  // Inset from the corners so the 1px line stays inside the border radius.
  topEdge: {
    position: 'absolute',
    top: StyleSheet.hairlineWidth,
    left: radii.lg,
    right: radii.lg,
    height: 1,
    borderRadius: 0.5,
  },
});
