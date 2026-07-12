import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { radii, spacing, useTheme } from '@/theme';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/** Animated pulsing placeholder block for first loads (never spinners). */
export function Skeleton({ width = '100%', height = 16, radius = radii.sm, style }: SkeletonProps) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.55,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: colors.surface2, opacity: pulse },
        style,
      ]}
    />
  );
}

export interface SkeletonListProps {
  rows?: number;
  /** Show a leading avatar circle per row. Default true. */
  avatar?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Skeleton rows shaped like ListItems — the default list loading state. */
export function SkeletonList({ rows = 6, avatar = true, style }: SkeletonListProps) {
  return (
    <View style={style}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.row}>
          {avatar ? <Skeleton width={40} height={40} radius={20} /> : null}
          <View style={styles.lines}>
            <Skeleton width="68%" height={14} />
            <Skeleton width="42%" height={11} style={styles.secondLine} />
          </View>
          <Skeleton width={56} height={14} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  lines: {
    flex: 1,
    marginHorizontal: spacing.md,
  },
  secondLine: {
    marginTop: spacing.sm - 2,
  },
});
