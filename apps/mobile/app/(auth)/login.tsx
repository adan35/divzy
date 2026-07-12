import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Link } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/hooks';
import { Button, Input, Screen } from '@/components/ui';
import { fontSize, spacing, useTheme, withAlpha } from '@/theme';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen() {
  const { signIn } = useAuth();
  const { colors } = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const validateEmail = (value: string): string | null => {
    if (!value.trim()) return 'Email is required';
    if (!EMAIL_RE.test(value.trim())) return 'Enter a valid email address';
    return null;
  };
  const validatePassword = (value: string): string | null =>
    value.length === 0 ? 'Password is required' : null;

  const canSubmit =
    validateEmail(email) === null && validatePassword(password) === null && !submitting;

  const handleSubmit = async () => {
    const nextEmailError = validateEmail(email);
    const nextPasswordError = validatePassword(password);
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    if (nextEmailError || nextPasswordError) return;

    setFormError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      // The (auth) layout redirects to the tabs once status flips to 'authed'.
    } catch (err) {
      setFormError(errorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.brand, { color: colors.brand }]}>Divzy</Text>
          <Text style={[styles.title, { color: colors.ink }]}>Welcome back</Text>
          <Text style={[styles.subtitle, { color: colors.ink2 }]}>
            Log in to keep every split fair.
          </Text>

          {formError ? (
            <View style={[styles.banner, { backgroundColor: withAlpha(colors.danger, 0.12) }]}>
              <Text style={[styles.bannerText, { color: colors.danger }]}>{formError}</Text>
            </View>
          ) : null}

          <Input
            label="Email"
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              if (emailError) setEmailError(validateEmail(value));
            }}
            onBlur={() => setEmailError(validateEmail(email))}
            error={emailError}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            returnKeyType="next"
            containerStyle={styles.field}
          />
          <Input
            label="Password"
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              if (passwordError) setPasswordError(validatePassword(value));
            }}
            onBlur={() => setPasswordError(validatePassword(password))}
            error={passwordError}
            secureTextEntry
            autoComplete="password"
            returnKeyType="go"
            onSubmitEditing={handleSubmit}
            containerStyle={styles.field}
          />

          <Button
            title="Log in"
            onPress={handleSubmit}
            loading={submitting}
            disabled={!canSubmit}
            size="lg"
            fullWidth
            style={styles.submit}
          />

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.ink2 }]}>New to Divzy? </Text>
            <Link href="/(auth)/register" style={[styles.footerLink, { color: colors.brand }]}>
              Create an account
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  brand: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  title: {
    fontSize: fontSize.hero,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  subtitle: {
    fontSize: fontSize.md,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  banner: {
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  bannerText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  field: {
    marginBottom: spacing.lg,
  },
  submit: {
    marginTop: spacing.xs,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  footerText: {
    fontSize: fontSize.sm,
  },
  footerLink: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
});
