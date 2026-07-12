import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fontSize, radii, spacing, useTheme } from '@/theme';

export interface ListItemProps {
  title: string;
  subtitle?: string;
  /** Icon rendered in a muted circle (ignored when `leading`/`emoji` given). */
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  /** Emoji rendered in a muted circle (takes precedence over `icon`). */
  emoji?: string;
  /** Fully custom leading element (avatar etc.) — wins over emoji/icon. */
  leading?: ReactNode;
  /** Right-aligned slot (amount, badge, switch...). */
  right?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function ListItem({
  title,
  subtitle,
  icon,
  iconColor,
  emoji,
  leading,
  right,
  chevron = false,
  onPress,
  style,
}: ListItemProps) {
  const { colors } = useTheme();

  const leadingNode =
    leading ??
    (emoji ? (
      <View style={[styles.bubble, { backgroundColor: colors.surface2 }]}>
        <Text style={styles.emoji}>{emoji}</Text>
      </View>
    ) : icon ? (
      <View style={[styles.bubble, { backgroundColor: colors.surface2 }]}>
        <Ionicons name={icon} size={19} color={iconColor ?? colors.ink2} />
      </View>
    ) : null);

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && onPress ? { backgroundColor: colors.surface2 } : null,
        style,
      ]}
    >
      {leadingNode ? <View style={styles.leading}>{leadingNode}</View> : null}
      <View style={styles.body}>
        <Text numberOfLines={1} style={[styles.title, { color: colors.ink }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={[styles.subtitle, { color: colors.ink3 }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
      {chevron ? (
        <Ionicons name="chevron-forward" size={18} color={colors.ink3} style={styles.chevron} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.md,
  },
  leading: {
    marginRight: spacing.md,
  },
  bubble: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 19,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  subtitle: {
    fontSize: fontSize.sm,
    marginTop: 1,
  },
  right: {
    marginLeft: spacing.md,
    alignItems: 'flex-end',
  },
  chevron: {
    marginLeft: spacing.sm,
  },
});
