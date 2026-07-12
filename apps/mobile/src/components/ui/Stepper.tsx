import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { fontSize, spacing, useTheme } from '@/theme';

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  style?: StyleProp<ViewStyle>;
}

/** Integer stepper (share counts etc.). */
export function Stepper({ value, onChange, min = 0, max = 999, step = 1, style }: StepperProps) {
  const { colors } = useTheme();
  const canDecrement = value - step >= min;
  const canIncrement = value + step <= max;

  const bump = (delta: number) => {
    Haptics.selectionAsync().catch(() => undefined);
    onChange(value + delta);
  };

  return (
    <View style={[styles.row, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Decrease"
        disabled={!canDecrement}
        onPress={() => bump(-step)}
        hitSlop={6}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: colors.surface2,
            opacity: !canDecrement ? 0.35 : pressed ? 0.7 : 1,
          },
        ]}
      >
        <Ionicons name="remove" size={18} color={colors.ink} />
      </Pressable>
      <Text style={[styles.value, { color: colors.ink }]}>{value}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Increase"
        disabled={!canIncrement}
        onPress={() => bump(step)}
        hitSlop={6}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: colors.surface2,
            opacity: !canIncrement ? 0.35 : pressed ? 0.7 : 1,
          },
        ]}
      >
        <Ionicons name="add" size={18} color={colors.ink} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  button: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    minWidth: 36,
    textAlign: 'center',
    fontSize: fontSize.md,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    marginHorizontal: spacing.xs,
  },
});
