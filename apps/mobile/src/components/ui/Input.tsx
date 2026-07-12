import { forwardRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { fontSize, radii, spacing, useTheme } from '@/theme';

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string | null;
  containerStyle?: StyleProp<ViewStyle>;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { label, error, containerStyle, style, onFocus, onBlur, editable = true, multiline, ...rest },
  ref,
) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error ? colors.danger : focused ? colors.brand : colors.hairline;

  return (
    <View style={containerStyle}>
      {label ? <Text style={[styles.label, { color: colors.ink2 }]}>{label}</Text> : null}
      <TextInput
        ref={ref}
        {...rest}
        editable={editable}
        multiline={multiline}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        placeholderTextColor={colors.ink3}
        style={[
          styles.input,
          multiline && styles.multiline,
          {
            color: colors.ink,
            backgroundColor: colors.surface,
            borderColor,
            opacity: editable ? 1 : 0.6,
          },
          style,
        ]}
      />
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  label: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginBottom: spacing.xs + 2,
  },
  input: {
    minHeight: 46,
    borderRadius: radii.lg,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: fontSize.md,
  },
  multiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  error: {
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
});
