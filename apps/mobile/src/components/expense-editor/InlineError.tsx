import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

export interface InlineErrorProps {
  /** API error message, shown verbatim per STYLE.md. Renders nothing when null. */
  message: string | null;
}

/** Inline error banner (mobile feedback = banners, not toasts). */
export function InlineError({ message }: InlineErrorProps) {
  const { colors } = useTheme();
  if (!message) return null;
  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: withAlpha(colors.danger, 0.12) }]}
    >
      <Ionicons name="alert-circle" size={18} color={colors.danger} />
      <Text style={[styles.text, { color: colors.danger }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
  },
  text: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: '500',
    lineHeight: 18,
  },
});
