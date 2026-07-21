import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CURRENCIES, getCurrency, type CurrencyInfo } from '@divzy/shared';
import { fontSize, spacing, useTheme } from '@/theme';
import { SearchPicker } from './SearchPicker';

export interface CurrencyPickerProps {
  value: string;
  onChange: (code: string) => void;
  label?: string;
  error?: string | null;
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * Field + modal list (searchable) over the shared supported-currency table.
 * WI-042: thin wrapper over the generic `SearchPicker<T>` — markup/behavior
 * reproduced verbatim from the pre-WI-042 implementation (named no-regression AC).
 */
export function CurrencyPicker({ value, onChange, label, error, containerStyle }: CurrencyPickerProps) {
  const { colors } = useTheme();

  return (
    <SearchPicker<CurrencyInfo>
      items={CURRENCIES as CurrencyInfo[]}
      value={value}
      onChange={onChange}
      getKey={(c) => c.code}
      getSearchText={(c) => `${c.code} ${c.name} ${c.symbol}`}
      label={label}
      error={error}
      containerStyle={containerStyle}
      modalTitle="Currency"
      searchPlaceholder="Search currencies"
      searchAutoCapitalize="characters"
      searchAutoCorrect={false}
      fieldAccessibilityLabel={(selected) => `Currency: ${(selected ?? getCurrency(value)).code}`}
      emptyLabel={(query) => `No currencies match “${query}”`}
      renderFieldLabel={(selected) => {
        const c = selected ?? getCurrency(value);
        return (
          <>
            <Text style={[styles.symbol, { color: colors.ink2 }]}>{c.symbol}</Text>
            <Text numberOfLines={1} style={[styles.fieldText, { color: colors.ink }]}>
              {c.code} · {c.name}
            </Text>
            <Ionicons name="chevron-down" size={16} color={colors.ink3} />
          </>
        );
      }}
      renderRow={(item, isSelected) => (
        <>
          <Text style={[styles.rowSymbol, { color: colors.ink2 }]}>{item.symbol}</Text>
          <View style={styles.rowBody}>
            <Text style={[styles.rowCode, { color: colors.ink }]}>{item.code}</Text>
            <Text numberOfLines={1} style={[styles.rowName, { color: colors.ink3 }]}>
              {item.name}
            </Text>
          </View>
          {isSelected ? <Ionicons name="checkmark" size={20} color={colors.brand} /> : null}
        </>
      )}
    />
  );
}

const styles = StyleSheet.create({
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
