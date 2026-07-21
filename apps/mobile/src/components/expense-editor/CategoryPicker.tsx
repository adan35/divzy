import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { type ExpenseCategory } from '@divzy/shared';
import { categoryPickerGrid } from '@/lib/categoryPickerNarrowing';
import { useUsedCategories } from '@/lib/hooks';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

export interface CategoryPickerProps {
  value: ExpenseCategory;
  onChange: (category: ExpenseCategory) => void;
  /** Group expenses narrow to the group's used categories (WI-032-3); undefined never narrows. */
  groupId?: string;
}

/**
 * Emoji grid over the shared category table (4 per row). For a group
 * expense, defaults to the group's used categories (plus the current form
 * value) with a "more categories" cell revealing the full 16 — see
 * spec-WI-032-3.
 */
export function CategoryPicker({ value, onChange, groupId }: CategoryPickerProps) {
  const { colors } = useTheme();
  const usedQuery = useUsedCategories(groupId);
  const [showAll, setShowAll] = useState(false);

  const { cells, showFull } = useMemo(
    () =>
      categoryPickerGrid({
        groupId,
        value,
        showAll,
        usedCategories: usedQuery.data?.categories,
        isLoading: usedQuery.isLoading,
        isError: usedQuery.isError,
      }),
    [groupId, value, showAll, usedQuery.data, usedQuery.isLoading, usedQuery.isError],
  );

  return (
    <View style={styles.grid}>
      {cells.map((category) => {
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
      {!showFull ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More categories"
          onPress={() => {
            Haptics.selectionAsync().catch(() => undefined);
            setShowAll(true);
          }}
          style={({ pressed }) => [
            styles.cell,
            {
              borderColor: colors.hairline,
              backgroundColor: pressed ? colors.surface2 : colors.surface,
            },
          ]}
        >
          <Text style={styles.emoji}>•••</Text>
          <Text numberOfLines={1} style={[styles.label, { color: colors.ink2 }]}>
            More
          </Text>
        </Pressable>
      ) : null}
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
