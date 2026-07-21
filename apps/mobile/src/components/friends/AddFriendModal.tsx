import { useState } from 'react';
import {
  ActivityIndicator,
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
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';
import { ApiError } from '@divzy/api-client';
import { zAddFriendInput, zEmail, zPhone } from '@divzy/shared';
import { Button, Input, SegmentedControl } from '@/components/ui';
import { extractFriendCodeFromScan, normalizeFriendCode } from '@/lib/friendCode';
import {
  errorMessage,
  useAddFriend,
  useAddFriendByCode,
  useFriendCode,
  useRotateFriendCode,
} from '@/lib/hooks';
import { fontSize, radii, spacing, useTheme, withAlpha } from '@/theme';

type AddFriendMode = 'email' | 'code' | 'scan';

const MODE_OPTIONS: ReadonlyArray<{ label: string; value: AddFriendMode }> = [
  { label: 'Email', value: 'email' },
  { label: 'My code', value: 'code' },
  { label: 'Scan', value: 'scan' },
];

export interface AddFriendModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Add-friend sheet (spec-WI-040): email (existing), the caller's own
 * persistent QR/share code, and a camera-scan + manual-entry fallback for
 * someone else's code. All three post through the standard add-friend
 * semantics (self-add rejected, idempotent, `ensureFriendshipsAmong`).
 */
export function AddFriendModal({ visible, onClose }: AddFriendModalProps) {
  const { colors } = useTheme();
  const [mode, setMode] = useState<AddFriendMode>('email');

  const close = () => {
    setMode('email');
    onClose();
  };

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

          <View style={styles.modeRow}>
            <SegmentedControl<AddFriendMode> options={MODE_OPTIONS} value={mode} onChange={setMode} />
          </View>

          {mode === 'email' ? (
            <EmailPane onDone={close} />
          ) : mode === 'code' ? (
            <MyCodePane />
          ) : (
            <ScanPane onDone={close} />
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Email (existing add-by-email path, unchanged behavior)
// ---------------------------------------------------------------------------

function EmailPane({ onDone }: { onDone: () => void }) {
  const { colors } = useTheme();
  const addFriend = useAddFriend();

  const [identifier, setIdentifier] = useState('');
  const [identifierError, setIdentifierError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validate = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return 'Email or phone is required';
    if (zEmail.safeParse(trimmed).success || zPhone.safeParse(trimmed).success) return null;
    return 'Enter a valid email or phone number';
  };

  const submit = () => {
    const nextError = validate(identifier);
    setIdentifierError(nextError);
    if (nextError) return;
    setSubmitError(null);
    const parsed = zAddFriendInput.safeParse({ identifier: identifier.trim() });
    if (!parsed.success) {
      setIdentifierError('Enter a valid email or phone number');
      return;
    }
    addFriend.mutate(parsed.data, {
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
          () => undefined,
        );
        onDone();
      },
      onError: (err) => setSubmitError(errorMessage(err)),
    });
  };

  const canSubmit = validate(identifier) === null && !addFriend.isPending;

  return (
    <View style={styles.body}>
      <Text style={[styles.hint, { color: colors.ink2 }]}>
        Enter the email or phone number your friend uses on Divzy. You can then split
        expenses and settle up with them directly.
      </Text>

      {submitError ? (
        <View style={[styles.banner, { backgroundColor: withAlpha(colors.danger, 0.12) }]}>
          <Text style={[styles.bannerText, { color: colors.danger }]}>{submitError}</Text>
        </View>
      ) : null}

      <Input
        label="Email or phone"
        value={identifier}
        onChangeText={(value) => {
          setIdentifier(value);
          if (identifierError) setIdentifierError(validate(value));
        }}
        onBlur={() => setIdentifierError(validate(identifier))}
        error={identifierError}
        keyboardType="default"
        autoCapitalize="none"
        autoComplete="off"
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
  );
}

// ---------------------------------------------------------------------------
// My code — persistent QR/share code (WI-040)
// ---------------------------------------------------------------------------

function MyCodePane() {
  const { colors } = useTheme();
  const codeQ = useFriendCode();
  const rotate = useRotateFriendCode();
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const copy = async () => {
    if (!codeQ.data) return;
    try {
      await Clipboard.setStringAsync(codeQ.data.shareUrl);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setCopyMessage('Link copied');
    } catch {
      setCopyMessage('Could not copy the link');
    }
  };

  const regenerate = () => {
    setCopyMessage(null);
    rotate.mutate(undefined, {
      onSuccess: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      ),
    });
  };

  if (codeQ.isLoading) {
    return (
      <View style={[styles.body, styles.centered]}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (codeQ.isError || !codeQ.data) {
    return (
      <View style={styles.body}>
        <View style={[styles.banner, { backgroundColor: withAlpha(colors.danger, 0.12) }]}>
          <Text style={[styles.bannerText, { color: colors.danger }]}>
            {errorMessage(codeQ.error)}
          </Text>
        </View>
        <Button title="Try again" variant="secondary" onPress={() => void codeQ.refetch()} />
      </View>
    );
  }

  return (
    <View style={[styles.body, styles.centered]}>
      <Text style={[styles.hint, { color: colors.ink2, textAlign: 'center' }]}>
        Share this code or QR so someone can add you without knowing your email.
      </Text>
      {/* QR codes need a true white quiet-zone regardless of theme — the
          S1-documented deliberate exception; `onBrand` happens to be the
          same literal value in both schemes, so this is token-driven rather
          than a raw hex, with zero visual change. */}
      <View style={[styles.qrWrap, { backgroundColor: colors.onBrand }]}>
        <QRCode value={codeQ.data.shareUrl} size={180} />
      </View>
      <View style={[styles.codePill, { backgroundColor: colors.surface2 }]}>
        <Text style={[styles.codeText, { color: colors.ink }]}>{codeQ.data.code}</Text>
      </View>
      {copyMessage ? (
        <Text style={[styles.copyMessage, { color: colors.ink2 }]}>{copyMessage}</Text>
      ) : null}
      <Button title="Copy link" variant="secondary" onPress={() => void copy()} fullWidth />
      <Button
        title="Regenerate code"
        variant="ghost"
        onPress={regenerate}
        loading={rotate.isPending}
        fullWidth
        style={styles.regenerateButton}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Scan — camera QR scan + manual-entry fallback (WI-040)
// ---------------------------------------------------------------------------

function ScanPane({ onDone }: { onDone: () => void }) {
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [scannedOnce, setScannedOnce] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const addByCode = useAddFriendByCode();

  const submitCode = (code: string) => {
    setAddError(null);
    addByCode.mutate(
      { code },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
            () => undefined,
          );
          onDone();
        },
        onError: (err) => {
          setScannedOnce(false); // allow re-scanning after a failed attempt
          if (err instanceof ApiError && err.code === 'CANNOT_ADD_SELF') {
            setAddError('That’s your own code — ask your friend to share theirs instead.');
          } else if (err instanceof ApiError && err.code === 'INVALID_CODE') {
            setAddError('That code is invalid or was regenerated. Ask for a fresh one.');
          } else {
            setAddError(errorMessage(err));
          }
        },
      },
    );
  };

  const onBarcodeScanned = ({ data }: { data: string }) => {
    if (scannedOnce || addByCode.isPending) return;
    const code = extractFriendCodeFromScan(data);
    if (!code) return;
    setScannedOnce(true);
    submitCode(code);
  };

  const submitManual = () => {
    const code = normalizeFriendCode(manualCode);
    if (!code) {
      setAddError('Enter a code');
      return;
    }
    submitCode(code);
  };

  return (
    <View style={styles.body}>
      {addError ? (
        <View style={[styles.banner, { backgroundColor: withAlpha(colors.danger, 0.12) }]}>
          <Text style={[styles.bannerText, { color: colors.danger }]}>{addError}</Text>
        </View>
      ) : null}

      {!permission ? null : !permission.granted ? (
        <View style={styles.centered}>
          <Text style={[styles.hint, { color: colors.ink2, textAlign: 'center' }]}>
            Divzy needs camera access to scan a friend's QR code.
          </Text>
          <Button title="Enable camera" onPress={() => void requestPermission()} />
        </View>
      ) : (
        <View style={[styles.cameraWrap, { borderColor: colors.hairline }]}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onBarcodeScanned}
          />
        </View>
      )}

      <Text style={[styles.orLabel, { color: colors.ink3 }]}>or enter a code manually</Text>
      <Input
        label="Friend code"
        value={manualCode}
        onChangeText={setManualCode}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="e.g. AB3XK92M7Q"
        containerStyle={styles.field}
      />
      <Button
        title="Add friend"
        onPress={submitManual}
        loading={addByCode.isPending}
        disabled={!manualCode.trim() || addByCode.isPending}
        size="lg"
        fullWidth
      />
    </View>
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
  modeRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    gap: spacing.md,
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
  qrWrap: {
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.md,
  },
  codePill: {
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  codeText: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    letterSpacing: 3,
    fontVariant: ['tabular-nums'],
  },
  copyMessage: {
    fontSize: fontSize.xs,
    marginBottom: spacing.sm,
  },
  regenerateButton: {
    marginTop: spacing.xs,
  },
  cameraWrap: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  camera: {
    flex: 1,
  },
  orLabel: {
    fontSize: fontSize.xs,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
});
