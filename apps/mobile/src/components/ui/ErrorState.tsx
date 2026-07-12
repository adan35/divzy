import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fontSize, spacing, useTheme } from '@/theme';
import { Button } from './Button';

export interface ErrorStateProps {
  /** API error message (use errorMessage() from '@/lib/hooks'). */
  message?: string;
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function ErrorState({
  message = 'Something went wrong. Please try again.',
  onRetry,
  style,
}: ErrorStateProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.root, style]}>
      <Ionicons name="cloud-offline-outline" size={34} color={colors.ink3} />
      <Text style={[styles.title, { color: colors.ink }]}>Something went wrong</Text>
      <Text style={[styles.message, { color: colors.ink3 }]}>{message}</Text>
      {onRetry ? (
        <Button title="Try again" variant="secondary" onPress={onRetry} style={styles.retry} />
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
  title: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    marginTop: spacing.md,
    textAlign: 'center',
  },
  message: {
    fontSize: fontSize.sm,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  retry: {
    marginTop: spacing.lg,
  },
});
