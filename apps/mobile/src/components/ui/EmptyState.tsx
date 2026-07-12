import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { fontSize, spacing, useTheme } from '@/theme';
import { Button } from './Button';

export interface EmptyStateProps {
  /** Context emoji: 🧾 expenses, 👥 friends, ✈️ groups ... */
  emoji: string;
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({ emoji, title, hint, actionLabel, onAction, style }: EmptyStateProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.root, style]}>
      <Text style={styles.emoji}>{emoji}</Text>
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
  emoji: {
    fontSize: 44,
    marginBottom: spacing.md,
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
