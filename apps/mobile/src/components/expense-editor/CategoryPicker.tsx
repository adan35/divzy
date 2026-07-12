import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@divzy/shared';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

export interface CategoryPickerProps {
  value: ExpenseCategory;
  onChange: (category: ExpenseCategory) => void;
}

/** Emoji grid over the shared category table (4 per row). */
export function CategoryPicker({ value, onChange }: CategoryPickerProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.grid}>
      {EXPENSE_CATEGORIES.map((category) => {
        const active = category.key === value;
        return (
          <Pressable
            key={category.key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={category.label}
            onPress={() => {
              if (active) return;
              Haptics.selectionAsync().catch(() => undefined);
              onChange(category.key);
            }}
            style={({ pressed }) => [
              styles.cell,
              {
                borderColor: active ? colors.brand : colors.hairline,
                backgroundColor: active
                  ? withAlpha(colors.brand, 0.1)
                  : pressed
                    ? colors.surface2
                    : colors.surface,
              },
            ]}
          >
            <Text style={styles.emoji}>{category.emoji}</Text>
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                { color: active ? colors.brand : colors.ink2 },
                active && styles.labelActive,
              ]}
            >
              {category.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cell: {
    // 4 per row: (100% - 3 gaps of 8) / 4 — flexBasis keeps rows tidy on any width.
    flexBasis: '22%',
    flexGrow: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.xs,
  },
  emoji: {
    fontSize: 22,
  },
  label: {
    fontSize: 11,
    marginTop: spacing.xs,
    fontWeight: '500',
  },
  labelActive: {
    fontWeight: '600',
  },
});
