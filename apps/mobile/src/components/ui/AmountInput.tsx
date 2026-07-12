import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { getCurrency, toMajorUnits, toMinorUnits } from '@divzy/shared';
import { fontSize, radii, spacing, useTheme } from '@/theme';

export interface AmountInputProps {
  currency: string;
  /** Amount in integer minor units; null while empty/invalid. */
  value: number | null;
  onChange: (minor: number | null) => void;
  label?: string;
  error?: string | null;
  autoFocus?: boolean;
  placeholder?: string;
  /** 'lg' = hero amount field (expense editor); 'md' = inline rows. */
  size?: 'md' | 'lg';
  containerStyle?: StyleProp<ViewStyle>;
}

function textFor(minor: number, currency: string): string {
  const { decimals } = getCurrency(currency);
  return toMajorUnits(minor, currency).toFixed(decimals);
}

/**
 * Money entry that speaks integer minor units. The user types a decimal
 * amount; every change is parsed with the shared `toMinorUnits` (string math,
 * no float artifacts) and reported via `onChange`.
 */
export function AmountInput({
  currency,
  value,
  onChange,
  label,
  error,
  autoFocus,
  placeholder = '0',
  size = 'lg',
  containerStyle,
}: AmountInputProps) {
  const { colors } = useTheme();
  const [text, setText] = useState(() => (value != null && value !== 0 ? textFor(value, currency) : ''));
  const [focused, setFocused] = useState(false);
  const lastEmitted = useRef<number | null>(value ?? null);
  const info = getCurrency(currency);

  // External resets (loading an expense for edit, currency switch, clear).
  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value ?? null;
      setText(value != null && value !== 0 ? textFor(value, currency) : '');
    }
  }, [value, currency]);

  const handleChange = (raw: string) => {
    // Keep digits plus a single decimal separator.
    const cleaned = raw.replace(/[^0-9.,]/g, '');
    const sepIndex = cleaned.search(/[.,]/);
    const normalized =
      sepIndex === -1
        ? cleaned
        : cleaned.slice(0, sepIndex + 1) + cleaned.slice(sepIndex + 1).replace(/[.,]/g, '');
    setText(normalized);

    if (normalized === '' || normalized === '.' || normalized === ',') {
      lastEmitted.current = null;
      onChange(null);
      return;
    }
    try {
      let parsable = /^[.,]/.test(normalized) ? `0${normalized}` : normalized;
      if (/[.,]$/.test(parsable)) parsable = parsable.slice(0, -1);
      const minor = toMinorUnits(parsable, currency);
      lastEmitted.current = minor;
      onChange(minor);
    } catch {
      lastEmitted.current = null;
      onChange(null);
    }
  };

  const large = size === 'lg';
  const borderColor = error ? colors.danger : focused ? colors.brand : colors.hairline;

  return (
    <View style={containerStyle}>
      {label ? <Text style={[styles.label, { color: colors.ink2 }]}>{label}</Text> : null}
      <View
        style={[
          styles.field,
          large && styles.fieldLg,
          { backgroundColor: colors.surface, borderColor },
        ]}
      >
        <Text style={[styles.symbol, large && styles.symbolLg, { color: colors.ink3 }]}>
          {info.symbol}
        </Text>
        <TextInput
          value={text}
          onChangeText={handleChange}
          keyboardType="decimal-pad"
          inputMode="decimal"
          autoFocus={autoFocus}
          placeholder={placeholder}
          placeholderTextColor={colors.ink3}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel={label ?? `Amount in ${info.code}`}
          style={[styles.input, large && styles.inputLg, { color: colors.ink }]}
        />
      </View>
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
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
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    minHeight: 46,
  },
  fieldLg: {
    minHeight: 60,
    paddingHorizontal: spacing.lg,
  },
  symbol: {
    fontSize: fontSize.md,
    fontWeight: '500',
    marginRight: spacing.sm - 2,
  },
  symbolLg: {
    fontSize: fontSize.xl,
  },
  input: {
    flex: 1,
    fontSize: fontSize.md,
    fontVariant: ['tabular-nums'],
    paddingVertical: spacing.sm,
  },
  inputLg: {
    fontSize: fontSize.xxl,
    fontWeight: '600',
  },
  error: {
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
});
