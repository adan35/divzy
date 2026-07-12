import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Button, Input } from '@/components/ui';
import { errorMessage, useAddFriend } from '@/lib/hooks';
import { fontSize, spacing, useTheme, withAlpha } from '@/theme';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AddFriendModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Add-friend sheet: enter an email, the API links you to that existing user
 * (404 USER_NOT_FOUND is surfaced verbatim).
 */
export function AddFriendModal({ visible, onClose }: AddFriendModalProps) {
  const { colors } = useTheme();
  const addFriend = useAddFriend();

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validate = (value: string): string | null => {
    if (!value.trim()) return 'Email is required';
    if (!EMAIL_RE.test(value.trim())) return 'Enter a valid email address';
    return null;
  };

  const close = () => {
    setEmail('');
    setEmailError(null);
    setSubmitError(null);
    addFriend.reset();
    onClose();
  };

  const submit = () => {
    const nextError = validate(email);
    setEmailError(nextError);
    if (nextError) return;
    setSubmitError(null);
    addFriend.mutate(
      { email: email.trim().toLowerCase() },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
            () => undefined,
          );
          close();
        },
        onError: (err) => {
          setSubmitError(errorMessage(err));
        },
      },
    );
  };

  const canSubmit = validate(email) === null && !addFriend.isPending;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
    >
      <SafeAreaView
        edges={['top', 'left', 'right', 'bottom']}
        style={[styles.root, { backgroundColor: colors.page }]}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.ink }]}>Add friend</Text>
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

          <View style={styles.body}>
            <Text style={[styles.hint, { color: colors.ink2 }]}>
              Enter the email your friend uses on Divzy. You can then split expenses and
              settle up with them directly.
            </Text>

            {submitError ? (
              <View style={[styles.banner, { backgroundColor: withAlpha(colors.danger, 0.12) }]}>
                <Text style={[styles.bannerText, { color: colors.danger }]}>{submitError}</Text>
              </View>
            ) : null}

            <Input
              label="Email"
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                if (emailError) setEmailError(validate(value));
              }}
              onBlur={() => setEmailError(validate(email))}
              error={emailError}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={submit}
              containerStyle={styles.field}
            />

            <Button
              title="Add friend"
              onPress={submit}
              loading={addFriend.isPending}
              disabled={!canSubmit}
              size="lg"
              fullWidth
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
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
  title: {
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
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  hint: {
    fontSize: fontSize.sm,
    lineHeight: 19,
    marginBottom: spacing.lg,
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
});
