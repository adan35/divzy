import { forwardRef } from 'react';
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { easing, motion, pressScale, spring } from '@/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  /**
   * Plain style only (no `({pressed}) => …` function form) — the pressed
   * affordance IS the scale; combine with your own tints via state if needed.
   */
  style?: StyleProp<ViewStyle>;
}

/**
 * WI-068 §4 — press feedback for cards/CTAs: scale 0.97 -> 1.0, transform
 * only (pressed states never shift layout bounds), ease-out press-in and a
 * spring return, all on the reanimated UI thread. Forwards every Pressable
 * prop, accessibility props included; `accessibilityRole` defaults to
 * "button". Under reduced motion the scale is skipped entirely (AC-8) —
 * press handlers still fire.
 */
export const PressableScale = forwardRef<View, PressableScaleProps>(function PressableScale(
  { onPressIn, onPressOut, accessibilityRole = 'button', style, ...rest },
  ref,
) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = (event: GestureResponderEvent) => {
    if (!reduceMotion) {
      scale.value = withTiming(pressScale, { duration: motion.fast, easing: easing.outExpo });
    }
    onPressIn?.(event);
  };

  const handlePressOut = (event: GestureResponderEvent) => {
    if (!reduceMotion) {
      scale.value = withSpring(1, spring);
    }
    onPressOut?.(event);
  };

  return (
    <AnimatedPressable
      ref={ref}
      accessibilityRole={accessibilityRole}
      {...rest}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[animatedStyle, style]}
    />
  );
});
