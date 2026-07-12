import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { CURRENCIES, getCurrency, type CurrencyInfo } from '@divzy/shared';
import { fontSize, radii, spacing, useTheme } from '@/theme';
import { Input } from './Input';

export interface CurrencyPickerProps {
  value: string;
  onChange: (code: string) => void;
  label?: string;
  error?: string | null;
  containerStyle?: StyleProp<ViewStyle>;
}

/** Field + modal list (searchable) over the shared supported-currency table. */
export function CurrencyPicker({ value, onChange, label, error, containerStyle }: CurrencyPickerProps) {
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  const selected = getCurrency(value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CURRENCIES;
    return CURRENCIES.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.symbol.toLowerCase().includes(q),
    );
  }, [query]);

  const close = () => {
    setVisible(false);
    setQuery('');
  };

  const select = (currency: CurrencyInfo) => {
    Haptics.selectionAsync().catch(() => undefined);
    onChange(currency.code);
    close();
  };

  return (
    <View style={containerStyle}>
      {label ? <Text style={[styles.label, { color: colors.ink2 }]}>{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Currency: ${selected.code}`}
        onPress={() => setVisible(true)}
        style={({ pressed }) => [
          styles.field,
          {
            backgroundColor: pressed ? colors.surface2 : colors.surface,
            borderColor: error ? colors.danger : colors.hairline,
          },
        ]}
      >
        <Text style={[styles.symbol, { color: colors.ink2 }]}>{selected.symbol}</Text>
        <Text numberOfLines={1} style={[styles.fieldText, { color: colors.ink }]}>
          {selected.code} · {selected.name}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.ink3} />
      </Pressable>
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

      <Modal visible={visible} animationType="slide" onRequestClose={close} presentationStyle="pageSheet">
        <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.modal, { backgroundColor: colors.page }]}>
          <View style={styles.header}>
            <Text style={[styles.headerTitle, { color: colors.ink }]}>Currency</Text>
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
            placeholder="Search currencies"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="characters"
            autoCorrect={false}
            containerStyle={styles.search}
          />
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.code}
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: colors.hairline }]} />
            )}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: colors.ink3 }]}>
                No currencies match “{query.trim()}”
              </Text>
            }
            renderItem={({ item }) => {
              const isSelected = item.code === selected.code;
              return (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => select(item)}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && { backgroundColor: colors.surface2 },
                  ]}
                >
                  <Text style={[styles.rowSymbol, { color: colors.ink2 }]}>{item.symbol}</Text>
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowCode, { color: colors.ink }]}>{item.code}</Text>
                    <Text numberOfLines={1} style={[styles.rowName, { color: colors.ink3 }]}>
                      {item.name}
                    </Text>
                  </View>
                  {isSelected ? <Ionicons name="checkmark" size={20} color={colors.brand} /> : null}
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
  symbol: {
    fontSize: fontSize.md,
    fontWeight: '600',
    marginRight: spacing.sm,
    minWidth: 22,
  },
  fieldText: {
    flex: 1,
    fontSize: fontSize.md,
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
    textAlign: 'center',
    fontSize: fontSize.sm,
    paddingVertical: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowSymbol: {
    fontSize: fontSize.md,
    fontWeight: '600',
    minWidth: 44,
  },
  rowBody: {
    flex: 1,
  },
  rowCode: {
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  rowName: {
    fontSize: fontSize.sm,
    marginTop: 1,
  },
});
