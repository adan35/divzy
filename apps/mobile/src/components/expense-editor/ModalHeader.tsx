import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { fontSize, spacing, useTheme } from '@/theme';

export interface ModalHeaderProps {
  title: string;
  subtitle?: string;
  /** Disable the close button (e.g. while saving). */
  closeDisabled?: boolean;
  onClose?: () => void;
}

/** Title + close row for modal screens (expense editor, settle up). */
export function ModalHeader({ title, subtitle, closeDisabled = false, onClose }: ModalHeaderProps) {
  const { colors } = useTheme();
  const router = useRouter();

  const handleClose = () => {
    if (onClose) {
      onClose();
      return;
    }
    if (router.canGoBack()) router.back();
  };

  return (
    <View style={styles.row}>
      <View style={styles.titles}>
        <Text numberOfLines={1} style={[styles.title, { color: colors.ink }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={[styles.subtitle, { color: colors.ink3 }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        disabled={closeDisabled}
        onPress={handleClose}
        hitSlop={8}
        style={({ pressed }) => [
          styles.close,
          {
            backgroundColor: pressed ? colors.surface2 : 'transparent',
            opacity: closeDisabled ? 0.4 : 1,
          },
        ]}
      >
        <Ionicons name="close" size={24} color={colors.ink2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  titles: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: fontSize.sm,
    marginTop: 1,
  },
  close: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
