import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { fontSize, radii, useTheme } from '@/theme';

export interface SegmentedOption<T extends string> {
  label: string;
  value: T;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  style,
}: SegmentedControlProps<T>) {
  const { colors, scheme } = useTheme();

  return (
    <View style={[styles.track, { backgroundColor: colors.surface2 }, style]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (active) return;
              Haptics.selectionAsync().catch(() => undefined);
              onChange(option.value);
            }}
            style={[
              styles.segment,
              active && [
                { backgroundColor: colors.surface, borderColor: colors.hairline },
                styles.activeSegment,
                scheme === 'light' && [styles.activeShadow, { shadowColor: colors.ink }],
              ],
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                { color: active ? colors.ink : colors.ink2, fontWeight: active ? '600' : '500' },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: radii.md,
    padding: 3,
  },
  segment: {
    flex: 1,
    minHeight: 32,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  activeSegment: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  activeShadow: {
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  label: {
    fontSize: fontSize.sm,
  },
});
