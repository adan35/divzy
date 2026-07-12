import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { fontSize, radii, spacing, useTheme } from '@/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

const SIZES: Record<ButtonSize, { height: number; padH: number; font: number; icon: number }> = {
  sm: { height: 34, padH: spacing.md, font: fontSize.sm, icon: 16 },
  md: { height: 44, padH: spacing.lg, font: fontSize.md, icon: 18 },
  lg: { height: 52, padH: spacing.xl, font: fontSize.lg, icon: 20 },
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  fullWidth = false,
  style,
}: ButtonProps) {
  const { colors } = useTheme();
  const dims = SIZES[size];

  const palette = {
    primary: { bg: colors.brand, fg: colors.onBrand },
    secondary: { bg: colors.surface2, fg: colors.ink },
    ghost: { bg: 'transparent', fg: colors.brand },
    destructive: { bg: colors.danger, fg: colors.onBrand },
  }[variant];

  const isDisabled = disabled || loading;

  const handlePress = () => {
    if (!onPress) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    onPress();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        {
          height: dims.height,
          paddingHorizontal: dims.padH,
          backgroundColor: palette.bg,
          opacity: isDisabled ? 0.55 : pressed ? 0.75 : 1,
        },
        fullWidth && styles.fullWidth,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? (
            <Ionicons name={icon} size={dims.icon} color={palette.fg} style={styles.icon} />
          ) : null}
          <Text
            numberOfLines={1}
            style={[styles.title, { color: palette.fg, fontSize: dims.font }]}
          >
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    marginRight: spacing.sm - 2,
  },
  title: {
    fontWeight: '600',
  },
});
