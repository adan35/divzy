import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fontSize, radii, spacing, useTheme } from '@/theme';
import { Button } from './Button';

export interface EmptyStateProps {
  /**
   * Context emoji: 🧾 expenses, 👥 friends, ✈️ groups… Kept back-compat
   * (WI-068): rendered inside a soft circle; prefer `icon` for new call
   * sites (§12: no emoji as structural icons).
   */
  emoji?: string;
  /** WI-068 (additive): Ionicons glyph, wins over `emoji` when both given. */
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  emoji,
  icon,
  title,
  hint,
  actionLabel,
  onAction,
  style,
}: EmptyStateProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.root, style]}>
      {icon || emoji ? (
        <View style={[styles.bubble, { backgroundColor: colors.surface2 }]}>
          {icon ? (
            <Ionicons name={icon} size={30} color={colors.ink2} />
          ) : (
            <Text style={styles.emoji}>{emoji}</Text>
          )}
        </View>
      ) : null}
      <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
      {hint ? <Text style={[styles.hint, { color: colors.ink3 }]}>{hint}</Text> : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} size="md" style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl + spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  bubble: {
    width: 72,
    height: 72,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emoji: {
    fontSize: 34,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    textAlign: 'center',
  },
  hint: {
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  action: {
    marginTop: spacing.lg,
  },
});
