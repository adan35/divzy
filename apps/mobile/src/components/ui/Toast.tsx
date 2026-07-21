import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { resolveToastDuration, resolveToastVisual, type ToastTone } from '@/lib/toast';
import { fontSize, radii, spacing, useTheme } from '@/theme';

export interface ToastProps {
  /** Present + non-empty = visible. Empty/undefined = hidden. */
  message: string;
  tone: ToastTone;
  /**
   * Bump on every trigger so the fade-in/auto-dismiss animation restarts
   * even when `message`/`tone` are identical to the previous call — this is
   * what makes repeated taps independent (AC5).
   */
  triggerId: number;
  /** ms before auto-dismiss. Defaults: success 2000, error 3000 (errors need more read time). */
  durationMs?: number;
}

/**
 * Minimal, non-blocking success/error confirmation pill. Absolutely
 * positioned near the top of the screen, `pointerEvents="none"` so it never
 * intercepts touches, fades in/out via RN's built-in `Animated` (no new
 * dependency), tone-colored background, single line, auto-dismisses.
 */
export function Toast({ message, tone, triggerId, durationMs }: ToastProps) {
  const { colors, scheme } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!message) return undefined;
    const duration = resolveToastDuration(tone, durationMs);
    opacity.setValue(0);
    const sequence = Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(duration),
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]);
    sequence.start();
    return () => sequence.stop();
    // Re-run on every trigger (even identical message/tone) — not on message/tone/durationMs
    // alone — so repeated taps each restart the animation independently (AC5).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerId]);

  if (!message) return null;

  const { icon, colorKey } = resolveToastVisual(tone);
  const toneColor = colors[colorKey];

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.container,
        { backgroundColor: toneColor, opacity },
        // WI-068 §1.1: shadows are a light-scheme tier only (slate-tinted);
        // in dark mode the tone fill separates on its own.
        scheme === 'light' && [styles.shadow, { shadowColor: colors.ink }],
      ]}
    >
      <Ionicons name={icon} size={18} color={colors.onBrand} />
      <Text numberOfLines={1} style={[styles.text, { color: colors.onBrand }]}>
        {message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 64,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    zIndex: 50,
  },
  shadow: {
    elevation: 6,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 6,
  },
  text: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    flex: 1,
  },
});
