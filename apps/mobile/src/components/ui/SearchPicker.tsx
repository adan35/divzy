import { useMemo, useState, type ReactNode } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { filterBySearch } from '@/lib/searchFilter';
import { fontSize, radii, spacing, useTheme } from '@/theme';
import { Input } from './Input';

export interface SearchPickerProps<T> {
  items: T[];
  value: string | null;
  onChange: (key: string) => void;
  getKey: (item: T) => string;
  /** Lowercased + `.includes()` matched (WI-042 D2 — no accent folding). */
  getSearchText: (item: T) => string;
  renderRow: (item: T, selected: boolean) => ReactNode;
  /** Closed-field content, given the currently selected item (if any). */
  renderFieldLabel: (selected: T | undefined) => ReactNode;
  /** Accessible name for the closed field's Pressable. */
  fieldAccessibilityLabel: (selected: T | undefined) => string;
  modalTitle: string;
  searchPlaceholder?: string;
  searchAutoCapitalize?: TextInputProps['autoCapitalize'];
  searchAutoCorrect?: boolean;
  /** Explicit "no results" state (WI-042 D6) — receives the trimmed query. */
  emptyLabel: (query: string) => ReactNode;
  label?: string;
  error?: string | null;
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * Generic searchable field + modal picker (WI-042 §3) — lifted from
 * `CurrencyPicker.tsx`'s modal/search/list mechanic: field trigger → Modal
 * (pageSheet) → search Input (focus on open) → useMemo filter → FlatList +
 * ListEmptyComponent → haptic select-and-close. `CurrencyPicker` and
 * `ContextPicker` (group/friend) are thin wrappers over this core supplying
 * only data + row/field markup.
 */
export function SearchPicker<T>({
  items,
  value,
  onChange,
  getKey,
  getSearchText,
  renderRow,
  renderFieldLabel,
  fieldAccessibilityLabel,
  modalTitle,
  searchPlaceholder,
  searchAutoCapitalize = 'none',
  searchAutoCorrect = false,
  emptyLabel,
  label,
  error,
  containerStyle,
}: SearchPickerProps<T>) {
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  const selected = useMemo(() => items.find((item) => getKey(item) === value), [items, getKey, value]);

  const filtered = useMemo(
    () => filterBySearch(items, query, getSearchText),
    [items, query, getSearchText],
  );

  const close = () => {
    setVisible(false);
    setQuery('');
  };

  const select = (item: T) => {
    Haptics.selectionAsync().catch(() => undefined);
    onChange(getKey(item));
    close();
  };

  return (
    <View style={containerStyle}>
      {label ? <Text style={[styles.label, { color: colors.ink2 }]}>{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={fieldAccessibilityLabel(selected)}
        onPress={() => setVisible(true)}
        style={({ pressed }) => [
          styles.field,
          {
            backgroundColor: pressed ? colors.surface2 : colors.surface,
            // WI-068 §1.1: picker fields sit in the input tier -> hairlineStrong.
            borderColor: error ? colors.danger : colors.hairlineStrong,
          },
        ]}
      >
        {renderFieldLabel(selected)}
      </Pressable>
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

      <Modal visible={visible} animationType="slide" onRequestClose={close} presentationStyle="pageSheet">
        <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.modal, { backgroundColor: colors.page }]}>
          <View style={styles.header}>
            <Text style={[styles.headerTitle, { color: colors.ink }]}>{modalTitle}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={close}
              hitSlop={8}
              style={({ pressed }) => [
                styles.closeButton,
                { backgroundColor: pressed ? colors.surface2 : 'transparent' },
              ]}
            >
              <Ionicons name="close" size={22} color={colors.ink2} />
            </Pressable>
          </View>
          <Input
            placeholder={searchPlaceholder}
            value={query}
            onChangeText={setQuery}
            autoCapitalize={searchAutoCapitalize}
            autoCorrect={searchAutoCorrect}
            containerStyle={styles.search}
          />
          <FlatList
            data={filtered}
            keyExtractor={getKey}
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: colors.hairline }]} />
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={[styles.emptyText, { color: colors.ink3 }]}>
                  {emptyLabel(query.trim())}
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const isSelected = getKey(item) === (selected ? getKey(selected) : undefined);
              return (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => select(item)}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && { backgroundColor: colors.surface2 },
                  ]}
                >
                  {renderRow(item, isSelected)}
                </Pressable>
              );
            }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginBottom: spacing.xs + 2,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
  },
  error: {
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  modal: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing.lg,
  },
  empty: {
    paddingVertical: spacing.xl,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: fontSize.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
});
