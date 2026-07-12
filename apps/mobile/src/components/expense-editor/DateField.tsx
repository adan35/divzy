import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { addMonths, format, isSameDay, isValid, parseISO, startOfMonth, subDays } from 'date-fns';
import { Input } from '@/components/ui';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

export interface DatePreset {
  key: string;
  label: string;
  /** Produce the preset's date (local) when tapped. */
  date: () => Date;
}

/** Noon local time — keeps the calendar day stable across timezones. */
function atNoon(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
}

/** Expense editor presets: Today / Yesterday / Custom. */
export const EXPENSE_DATE_PRESETS: DatePreset[] = [
  { key: 'today', label: 'Today', date: () => atNoon(new Date()) },
  { key: 'yesterday', label: 'Yesterday', date: () => atNoon(subDays(new Date(), 1)) },
];

/** Recurring editor presets: Today / 1st of next month / Custom. */
export const RECURRING_DATE_PRESETS: DatePreset[] = [
  { key: 'today', label: 'Today', date: () => atNoon(new Date()) },
  {
    key: 'next-month',
    label: '1st of next month',
    date: () => atNoon(startOfMonth(addMonths(new Date(), 1))),
  },
];

export interface DateFieldProps {
  label?: string;
  /** ISO 8601 datetime string. */
  value: string;
  onChange: (iso: string) => void;
  presets?: DatePreset[];
}

const DATE_TEXT_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateText(text: string): Date | null {
  const match = DATE_TEXT_RE.exec(text.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (!isValid(date) || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/**
 * Native-feel date entry: a chip row of quick presets plus a Custom chip that
 * reveals a simple YYYY-MM-DD text input. Emits ISO datetime strings.
 */
export function DateField({
  label = 'Date',
  value,
  onChange,
  presets = EXPENSE_DATE_PRESETS,
}: DateFieldProps) {
  const { colors } = useTheme();
  const parsedValue = parseISO(value);
  const valueValid = isValid(parsedValue);

  const matchedPreset = valueValid
    ? presets.find((p) => isSameDay(p.date(), parsedValue))
    : undefined;

  const [customOpen, setCustomOpen] = useState(!matchedPreset);
  const [customText, setCustomText] = useState(() =>
    valueValid ? format(parsedValue, 'yyyy-MM-dd') : '',
  );
  const [customError, setCustomError] = useState<string | null>(null);

  const activeKey = customOpen ? 'custom' : matchedPreset?.key ?? 'custom';

  const pickPreset = (preset: DatePreset) => {
    Haptics.selectionAsync().catch(() => undefined);
    setCustomOpen(false);
    setCustomError(null);
    const date = preset.date();
    setCustomText(format(date, 'yyyy-MM-dd'));
    onChange(date.toISOString());
  };

  const openCustom = () => {
    Haptics.selectionAsync().catch(() => undefined);
    setCustomOpen(true);
    setCustomError(null);
    if (valueValid) setCustomText(format(parsedValue, 'yyyy-MM-dd'));
  };

  const handleCustomText = (text: string) => {
    setCustomText(text);
    if (text.trim() === '') {
      setCustomError(null);
      return;
    }
    const date = parseDateText(text);
    if (!date) {
      setCustomError('Use the format YYYY-MM-DD, e.g. 2026-07-01');
      return;
    }
    setCustomError(null);
    onChange(date.toISOString());
  };

  const chip = (key: string, chipLabel: string, onPress: () => void) => {
    const active = key === activeKey;
    return (
      <Pressable
        key={key}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        onPress={onPress}
        style={({ pressed }) => [
          styles.chip,
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
        <Text
          style={[
            styles.chipText,
            { color: active ? colors.brand : colors.ink2, fontWeight: active ? '600' : '500' },
          ]}
        >
          {chipLabel}
        </Text>
      </Pressable>
    );
  };

  return (
    <View>
      <Text style={[styles.label, { color: colors.ink2 }]}>{label}</Text>
      <View style={styles.chipRow}>
        {presets.map((preset) => chip(preset.key, preset.label, () => pickPreset(preset)))}
        {chip('custom', 'Custom', openCustom)}
      </View>
      {customOpen ? (
        <Input
          value={customText}
          onChangeText={handleCustomText}
          placeholder="YYYY-MM-DD"
          keyboardType="numbers-and-punctuation"
          autoCorrect={false}
          autoCapitalize="none"
          maxLength={10}
          error={customError}
          accessibilityLabel={`${label}, format YYYY-MM-DD`}
          containerStyle={styles.customInput}
        />
      ) : valueValid ? (
        <Text style={[styles.valueText, { color: colors.ink3 }]}>
          {format(parsedValue, 'EEEE, MMMM d, yyyy')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginBottom: spacing.xs + 2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    borderWidth: 1,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 1,
  },
  chipText: {
    fontSize: fontSize.sm,
  },
  customInput: {
    marginTop: spacing.sm,
  },
  valueText: {
    fontSize: fontSize.xs,
    marginTop: spacing.xs + 2,
  },
});
