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
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { zEmail, zPhone } from '@divzy/shared';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/hooks';
import { Button, Input, Screen } from '@/components/ui';
import { fontSize, radii, spacing, topEdgeHighlight, useTheme, withAlpha } from '@/theme';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const { colors, scheme } = useTheme();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [identifierError, setIdentifierError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // WI-045: a single "identifier" field accepts either shape, classified via
  // the same shared zEmail/zPhone schemas the server's zLoginInput transform
  // uses — no hand-rolled regex, no normalization (e.g. lowercasing) applied
  // here beyond what those schemas already do themselves.
  const validateIdentifier = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return 'Email or phone is required';
    if (zEmail.safeParse(trimmed).success) return null;
    if (zPhone.safeParse(trimmed).success) return null;
    return 'Enter a valid email or phone number';
  };
  const validatePassword = (value: string): string | null =>
    value.length === 0 ? 'Password is required' : null;

  const canSubmit =
    validateIdentifier(identifier) === null && validatePassword(password) === null && !submitting;

  const handleSubmit = async () => {
    const nextIdentifierError = validateIdentifier(identifier);
    const nextPasswordError = validatePassword(password);
    setIdentifierError(nextIdentifierError);
    setPasswordError(nextPasswordError);
    if (nextIdentifierError || nextPasswordError) return;

    setFormError(null);
    setSubmitting(true);
    try {
      await signIn(identifier.trim(), password);
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
          {/* WI-068 §9.2 — type-only wordmark treatment (no logo change):
              ink text with a restrained gold "." accent, replacing the
              plain brand-blue wordmark (mirrors the web nav-shell/auth
              treatment). */}
          <Text style={[styles.brand, { color: colors.ink }]}>
            divzy
            <Text style={{ color: colors.accent }}>.</Text>
          </Text>

          {/* Auth card on `elevated` (spec §9.2): dialog/popover surface tier,
              light-scheme shadow / dark-scheme border + top-edge highlight —
              the same elevation contract Card.tsx uses, applied locally since
              Card is a fixed `surface` background (S1-owned, not edited). */}
          <View
            style={[
              styles.card,
              { backgroundColor: colors.elevated, borderColor: colors.hairline },
              scheme === 'light' && [styles.cardShadow, { shadowColor: colors.ink }],
            ]}
          >
            {scheme === 'dark' ? (
              <View
                pointerEvents="none"
                style={[styles.cardTopEdge, { backgroundColor: topEdgeHighlight }]}
              />
            ) : null}
            <Text style={[styles.title, { color: colors.ink }]}>Welcome back</Text>
            <Text style={[styles.subtitle, { color: colors.ink2 }]}>
              Log in to keep every split fair.
            </Text>

            {formError ? (
              <View style={[styles.banner, { backgroundColor: withAlpha(colors.neg, 0.12) }]}>
                <Ionicons name="alert-circle" size={16} color={colors.neg} />
                <Text style={[styles.bannerText, { color: colors.neg }]}>{formError}</Text>
              </View>
            ) : null}

            <Input
              label="Email or phone"
              placeholder="you@example.com or +1 415 555 2671"
              value={identifier}
              onChangeText={(value) => {
                setIdentifier(value);
                if (identifierError) setIdentifierError(validateIdentifier(value));
              }}
              onBlur={() => setIdentifierError(validateIdentifier(identifier))}
              error={identifierError}
              keyboardType="default"
              autoCapitalize="none"
              autoComplete="off"
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
          </View>

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
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.5,
    marginBottom: spacing.lg,
  },
  // WI-068 §9.2 — auth card on `elevated`, matching Card.tsx's own elevation
  // contract (light shadow-1 / dark hairline + top-edge highlight).
  card: {
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.xl,
  },
  cardShadow: {
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  cardTopEdge: {
    position: 'absolute',
    top: StyleSheet.hairlineWidth,
    left: radii.lg,
    right: radii.lg,
    height: 1,
    borderRadius: 0.5,
  },
  title: {
    fontSize: fontSize.hero,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: fontSize.md,
    textAlign: 'center',
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  bannerText: {
    flex: 1,
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
