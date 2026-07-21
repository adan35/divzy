import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { spacing, useTheme } from '@/theme';

export interface FABProps {
  onPress: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Floating action button, bottom-right. */
export function FAB({ onPress, icon = 'add', accessibilityLabel = 'Add', style }: FABProps) {
  const { colors, scheme } = useTheme();

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    onPress();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.fab,
        // WI-068: fills consume brandFill/brandFillPressed (§1.1); dark
        // elevation uses no shadows (§1.1) — the fill itself separates.
        { backgroundColor: pressed ? colors.brandFillPressed : colors.brandFill },
        scheme === 'light' && [styles.shadow, { shadowColor: colors.ink }],
        style,
      ]}
    >
      <Ionicons name={icon} size={26} color={colors.onBrand} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shadow: {
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
});
