import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { fontSize, radii, useTheme } from '@/theme';
import { initials } from '@/lib/format';

export interface AvatarProps {
  name: string;
  /** user.avatarColor — falls back to brand. */
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export function Avatar({ name, color, size = 40, style }: AvatarProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color ?? colors.brand },
        style,
      ]}
    >
      <Text style={[styles.initials, { color: colors.onBrand, fontSize: Math.max(10, Math.round(size * 0.38)) }]}>
        {initials(name)}
      </Text>
    </View>
  );
}

export interface AvatarStackProps {
  users: Array<{ id: string; name: string; avatarColor: string }>;
  size?: number;
  /** Avatars shown before folding the rest into a "+N" bubble. Default 4. */
  max?: number;
  style?: StyleProp<ViewStyle>;
}

export function AvatarStack({ users, size = 28, max = 4, style }: AvatarStackProps) {
  const { colors } = useTheme();
  const shown = users.slice(0, max);
  const overflow = users.length - shown.length;
  const overlap = -Math.round(size / 3);

  return (
    <View style={[styles.stack, style]}>
      {shown.map((user, index) => (
        <View
          key={user.id}
          style={[
            styles.stackItem,
            { borderColor: colors.surface, borderRadius: radii.full },
            index > 0 && { marginLeft: overlap },
          ]}
        >
          <Avatar name={user.name} color={user.avatarColor} size={size} />
        </View>
      ))}
      {overflow > 0 ? (
        <View
          style={[
            styles.stackItem,
            styles.overflowBubble,
            {
              width: size + 4,
              height: size + 4,
              borderRadius: (size + 4) / 2,
              backgroundColor: colors.surface2,
              borderColor: colors.surface,
              marginLeft: overlap,
            },
          ]}
        >
          <Text style={[styles.overflowText, { color: colors.ink2 }]}>+{overflow}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontWeight: '600',
  },
  stack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stackItem: {
    borderWidth: 2,
  },
  overflowBubble: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowText: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
});
