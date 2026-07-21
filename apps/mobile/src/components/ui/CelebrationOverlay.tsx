import { useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import {
  CELEBRATION_DURATION_MS,
  createParticles,
  useCelebration,
  type CelebrationParticle,
} from '@/lib/celebration';
import { easing, useTheme } from '@/theme';

/**
 * WI-068 §7 — the settle-success particle burst. Mounted ONCE at the root
 * (`app/_layout.tsx`, slice S5's edit) so navigation after settle doesn't
 * kill it; driven by the celebration store (`celebrate()` in settle
 * onSuccess). One shared timing value (<= 1000ms, UI thread) animates
 * opacity + translate + rotate for 18–24 particles, then the store returns
 * to idle and the layer unmounts.
 *
 * Inert by construction: pointerEvents "none" and hidden from the
 * accessibility tree — it is pure decoration. Reduced motion (AC-7c): the
 * visual is skipped entirely (store snaps back to idle); the success haptic
 * lives at the settle call site and still fires.
 */
export function CelebrationOverlay() {
  const status = useCelebration((state) => state.status);
  const celebrationId = useCelebration((state) => state.celebrationId);
  const finish = useCelebration((state) => state.finish);
  const reduceMotion = useReducedMotion();

  // Reduced motion: acknowledge the trigger immediately, render nothing.
  useEffect(() => {
    if (reduceMotion && status === 'celebrating') finish();
  }, [reduceMotion, status, celebrationId, finish]);

  if (status !== 'celebrating' || reduceMotion) return null;

  // Keyed on celebrationId: a re-trigger mid-burst remounts a fresh burst.
  return <Burst key={celebrationId} onDone={finish} />;
}

function Burst({ onDone }: { onDone: () => void }) {
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const particles = useMemo(() => createParticles(), []);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(
      1,
      { duration: CELEBRATION_DURATION_MS, easing: easing.outExpo },
      (finished) => {
        // Not called with finished=false on cancel (a newer burst replaced
        // this one and owns the next finish()).
        if (finished) runOnJS(onDone)();
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.layer]}
      pointerEvents="none"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {particles.map((particle) => (
        <Particle
          key={particle.key}
          particle={particle}
          progress={progress}
          color={colors[particle.colorKey]}
          originX={width / 2}
          originY={height * 0.4}
        />
      ))}
    </View>
  );
}

interface ParticleProps {
  particle: CelebrationParticle;
  progress: SharedValue<number>;
  color: string;
  originX: number;
  originY: number;
}

function Particle({ particle, progress, color, originX, originY }: ParticleProps) {
  const animatedStyle = useAnimatedStyle(() => {
    // Per-particle stagger carved out of the single shared timeline.
    const t = interpolate(progress.value, [particle.delayNorm, 1], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: interpolate(t, [0, 0.08, 0.7, 1], [0, 1, 1, 0]),
      transform: [
        { translateX: particle.dx * t },
        // Radial rise to the apex, then the gravity fall.
        { translateY: interpolate(t, [0, 0.45, 1], [0, particle.riseY, particle.fallY]) },
        { rotate: `${particle.rotation * t}deg` },
      ],
    };
  });

  return (
    <Animated.View
      style={[
        styles.particle,
        {
          left: originX,
          top: originY,
          width: particle.size,
          height: particle.size,
          backgroundColor: color,
        },
        animatedStyle,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  layer: {
    // Above screen content and sheets; the layer is transient and inert.
    zIndex: 1000,
    overflow: 'hidden',
  },
  particle: {
    position: 'absolute',
    borderRadius: 2,
  },
});
