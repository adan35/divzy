import { useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { AVATAR_COLORS, LIMITS } from '@divzy/shared';
import {
  Avatar,
  Button,
  Card,
  CurrencyPicker,
  Input,
  Screen,
  SectionHeader,
} from '@/components/ui';
import { useAuth } from '@/lib/auth';
import {
  errorMessage,
  useChangePassword,
  useUpdateMe,
  useUploadAvatar,
} from '@/lib/hooks';
import { validateAvatarFile } from '@/lib/avatarUpload';
import { fontSize, spacing, useTheme, withAlpha } from '@/theme';

function Banner({ text, tone }: { text: string; tone: 'danger' | 'pos' }) {
  const { colors } = useTheme();
  const color = tone === 'danger' ? colors.danger : colors.pos;
  return (
    <View style={[styles.banner, { backgroundColor: withAlpha(color, 0.12) }]}>
      <Text style={[styles.bannerText, { color }]}>{text}</Text>
    </View>
  );
}

export default function AccountTab() {
  const { colors } = useTheme();
  const { user, signOut } = useAuth();

  const profileMutation = useUpdateMe();
  const currencyMutation = useUpdateMe();
  const notificationsMutation = useUpdateMe();
  const remindersMutation = useUpdateMe();
  // WI-045 — its OWN mutation instance, same one-instance-per-control rule as
  // every other PREFERENCES control on this screen: a pending/error phone
  // save must never couple to name/currency/notification/reminder state.
  const phoneMutation = useUpdateMe();
  const changePassword = useChangePassword();

  // Avatar upload (WI-035) — its OWN mutation instances, separate from every
  // other control on this screen (profile/currency/notifications/reminders
  // above each already follow this same one-instance-per-control rule): a
  // shared instance would couple this control's pending/disabled state to
  // unrelated controls (known recurring defect, flagged in the design + DRB
  // review).
  const avatarUpload = useUploadAvatar();
  const avatarMutation = useUpdateMe();
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // Profile edit state
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [colorDraft, setColorDraft] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);

  // Password form state
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const [prefsError, setPrefsError] = useState<string | null>(null);

  // Phone edit state (WI-045)
  const [phoneEditing, setPhoneEditing] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);

  if (!user) {
    return (
      <Screen>
        <View />
      </Screen>
    );
  }

  const startEditing = () => {
    setNameDraft(user.name);
    setColorDraft(user.avatarColor);
    setProfileError(null);
    setEditing(true);
  };

  const saveProfile = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setProfileError('Name is required');
      return;
    }
    setProfileError(null);
    profileMutation.mutate(
      { name: trimmed, avatarColor: colorDraft },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
            () => undefined,
          );
          setEditing(false);
        },
        onError: (err) => setProfileError(errorMessage(err)),
      },
    );
  };

  // -- Phone number (WI-045) ---------------------------------------------------

  const startPhoneEditing = () => {
    setPhoneDraft(user.phone ?? '');
    setPhoneError(null);
    setPhoneEditing(true);
  };

  const cancelPhoneEditing = () => {
    setPhoneEditing(false);
    setPhoneError(null);
  };

  const savePhone = () => {
    const trimmed = phoneDraft.trim();
    // Empty input clears the phone (sends null); a non-empty value is
    // forwarded as-is — zPhone (server + shared schema) owns format
    // validation/normalization, no duplicate regex here.
    const next = trimmed.length === 0 ? null : trimmed;
    setPhoneError(null);
    phoneMutation.mutate(
      { phone: next },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
            () => undefined,
          );
          setPhoneEditing(false);
        },
        onError: (err) => setPhoneError(errorMessage(err)),
      },
    );
  };

  // -- Avatar upload / replace / remove (WI-035) ------------------------------

  const applyAvatarUrl = (url: string | null) => {
    setAvatarError(null);
    avatarMutation.mutate(
      { avatarUrl: url },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
            () => undefined,
          );
        },
        onError: (err) => setAvatarError(errorMessage(err)),
      },
    );
  };

  const handlePickedAvatar = (asset: ImagePicker.ImagePickerAsset) => {
    setAvatarError(null);
    // Client-side pre-validation (size + MIME) — fast feedback before a
    // network round trip. The server independently re-validates regardless
    // (defense in depth, WI-035 §5).
    const validation = validateAvatarFile({ mimeType: asset.mimeType, size: asset.fileSize });
    if (!validation.ok) {
      setAvatarError(validation.message ?? 'That image cannot be used.');
      return;
    }
    const extension = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
    const name = asset.fileName ?? `avatar-${Date.now()}.${extension}`;
    const type = asset.mimeType ?? 'image/jpeg';
    avatarUpload.mutate(
      { uri: asset.uri, name, type },
      {
        onSuccess: (res) => applyAvatarUrl(res.url),
        onError: (err) => setAvatarError(errorMessage(err)),
      },
    );
  };

  const pickAvatarFromLibrary = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsEditing: true,
        aspect: [1, 1],
      });
      const asset = result.assets?.[0];
      if (!result.canceled && asset) handlePickedAvatar(asset);
    } catch {
      setAvatarError('Could not open your photo library.');
    }
  };

  const takeAvatarPhoto = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setAvatarError('Camera access is needed to take a profile photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.8,
        allowsEditing: true,
        aspect: [1, 1],
      });
      const asset = result.assets?.[0];
      if (!result.canceled && asset) handlePickedAvatar(asset);
    } catch {
      setAvatarError('Could not open the camera.');
    }
  };

  const openAvatarPicker = () => {
    setAvatarError(null);
    Alert.alert(user.avatarUrl ? 'Change profile photo' : 'Add profile photo', undefined, [
      { text: 'Take photo', onPress: () => void takeAvatarPhoto() },
      { text: 'Choose from library', onPress: () => void pickAvatarFromLibrary() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const removeAvatar = () => applyAvatarUrl(null);

  const avatarBusy = avatarUpload.isPending || avatarMutation.isPending;

  const changeCurrency = (code: string) => {
    if (code === user.defaultCurrency) return;
    setPrefsError(null);
    currencyMutation.mutate(
      { defaultCurrency: code },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
            () => undefined,
          );
        },
        onError: (err) => setPrefsError(errorMessage(err)),
      },
    );
  };

  const toggleNotifications = (value: boolean) => {
    setPrefsError(null);
    notificationsMutation.mutate(
      { emailNotifications: value },
      {
        onError: (err) => setPrefsError(errorMessage(err)),
      },
    );
  };

  const toggleStaleBalanceReminders = (value: boolean) => {
    setPrefsError(null);
    remindersMutation.mutate(
      { staleBalanceRemindersEnabled: value },
      {
        onError: (err) => setPrefsError(errorMessage(err)),
      },
    );
  };

  const passwordValid =
    currentPassword.length > 0 &&
    newPassword.length >= LIMITS.PASSWORD_MIN &&
    confirmPassword === newPassword;

  const submitPassword = () => {
    if (!passwordValid) return;
    setPasswordError(null);
    setPasswordSuccess(false);
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
            () => undefined,
          );
          setCurrentPassword('');
          setNewPassword('');
          setConfirmPassword('');
          setPasswordSuccess(true);
        },
        onError: (err) => setPasswordError(errorMessage(err)),
      },
    );
  };

  const confirmSignOut = () => {
    Alert.alert('Sign out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void signOut();
        },
      },
    ]);
  };

  return (
    <Screen scroll>
      <Text style={[styles.title, { color: colors.ink }]}>Account</Text>

      {/* Profile */}
      <Card style={styles.profileCard}>
        <View style={styles.profileRow}>
          <Avatar
            name={editing ? nameDraft || user.name : user.name}
            color={editing ? colorDraft : user.avatarColor}
            avatarUrl={user.avatarUrl}
            size={56}
          />
          <View style={styles.profileBody}>
            <Text numberOfLines={1} style={[styles.profileName, { color: colors.ink }]}>
              {user.name}
            </Text>
            <Text numberOfLines={1} style={[styles.profileEmail, { color: colors.ink3 }]}>
              {user.email}
            </Text>
          </View>
          {!editing ? (
            <Button title="Edit" variant="secondary" size="sm" onPress={startEditing} />
          ) : null}
        </View>

        {avatarError ? <Banner text={avatarError} tone="danger" /> : null}
        <View style={styles.avatarActions}>
          <Button
            title={avatarUpload.isPending ? 'Uploading…' : user.avatarUrl ? 'Change photo' : 'Add photo'}
            variant="secondary"
            size="sm"
            loading={avatarUpload.isPending}
            disabled={avatarBusy}
            onPress={openAvatarPicker}
          />
          <Button
            title="Remove"
            variant="ghost"
            size="sm"
            disabled={!user.avatarUrl || avatarBusy}
            onPress={removeAvatar}
          />
        </View>

        {editing ? (
          <View style={styles.editBlock}>
            {profileError ? <Banner text={profileError} tone="danger" /> : null}
            <Input
              label="Name"
              value={nameDraft}
              onChangeText={setNameDraft}
              maxLength={LIMITS.NAME_MAX}
              autoCapitalize="words"
              containerStyle={styles.field}
            />
            <Text style={[styles.swatchLabel, { color: colors.ink2 }]}>Avatar color</Text>
            <View style={styles.swatches}>
              {AVATAR_COLORS.map((color) => {
                const selected = color === colorDraft;
                return (
                  <Pressable
                    key={color}
                    accessibilityRole="button"
                    accessibilityLabel={`Avatar color ${color}`}
                    accessibilityState={{ selected }}
                    onPress={() => setColorDraft(color)}
                    style={[
                      styles.swatch,
                      { backgroundColor: color },
                      selected && { borderColor: colors.ink, borderWidth: 2 },
                    ]}
                  >
                    {selected ? (
                      <Ionicons name="checkmark" size={16} color={colors.onBrand} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.editActions}>
              <Button
                title="Cancel"
                variant="ghost"
                onPress={() => setEditing(false)}
                disabled={profileMutation.isPending}
              />
              <Button
                title="Save"
                onPress={saveProfile}
                loading={profileMutation.isPending}
                disabled={nameDraft.trim().length === 0}
              />
            </View>
          </View>
        ) : null}
      </Card>

      {/* Preferences */}
      <SectionHeader title="PREFERENCES" />
      {prefsError ? <Banner text={prefsError} tone="danger" /> : null}
      <Card>
        <CurrencyPicker
          label="Default currency"
          value={user.defaultCurrency}
          onChange={changeCurrency}
        />

        {/* Phone (WI-045) — its own edit flow, independent of every other control here. */}
        <View style={[styles.prefRow, styles.prefRowSpaced]}>
          <View style={[styles.prefIcon, { backgroundColor: colors.surface2 }]}>
            <Ionicons name="call-outline" size={18} color={colors.ink2} />
          </View>
          <View style={styles.prefBody}>
            <Text style={[styles.prefTitle, { color: colors.ink }]}>Phone number</Text>
            <Text style={[styles.prefHint, { color: colors.ink3 }]}>
              {user.phone ?? 'Not set — used to log in and be found by friends'}
            </Text>
          </View>
          {!phoneEditing ? (
            <Button
              title={user.phone ? 'Edit' : 'Add'}
              variant="secondary"
              size="sm"
              onPress={startPhoneEditing}
            />
          ) : null}
        </View>
        {phoneEditing ? (
          <View style={styles.editBlock}>
            {phoneError ? <Banner text={phoneError} tone="danger" /> : null}
            <Input
              label="Phone number"
              placeholder="+1 415 555 2671"
              value={phoneDraft}
              onChangeText={setPhoneDraft}
              keyboardType="phone-pad"
              autoCapitalize="none"
              autoComplete="tel"
              autoCorrect={false}
              containerStyle={styles.field}
            />
            <View style={styles.editActions}>
              <Button
                title="Cancel"
                variant="ghost"
                onPress={cancelPhoneEditing}
                disabled={phoneMutation.isPending}
              />
              <Button
                title="Save"
                onPress={savePhone}
                loading={phoneMutation.isPending}
              />
            </View>
          </View>
        ) : null}

        <View style={[styles.prefRow, styles.prefRowSpaced]}>
          <View style={styles.prefBody}>
            <Text style={[styles.prefTitle, { color: colors.ink }]}>Email notifications</Text>
            <Text style={[styles.prefHint, { color: colors.ink3 }]}>
              Get an email when expenses and payments involve you
            </Text>
          </View>
          <Switch
            value={user.emailNotifications}
            onValueChange={toggleNotifications}
            disabled={notificationsMutation.isPending}
            trackColor={{ false: colors.surface2, true: colors.brand }}
            thumbColor={colors.onBrand}
          />
        </View>
        <View style={[styles.prefRow, styles.prefRowSpaced]}>
          <View style={styles.prefBody}>
            <Text style={[styles.prefTitle, { color: colors.ink }]}>
              Stale balance reminders
            </Text>
            <Text style={[styles.prefHint, { color: colors.ink3 }]}>
              Get a reminder email when a balance has been outstanding for a while
            </Text>
          </View>
          <Switch
            value={user.staleBalanceRemindersEnabled}
            onValueChange={toggleStaleBalanceReminders}
            disabled={remindersMutation.isPending}
            trackColor={{ false: colors.surface2, true: colors.brand }}
            thumbColor={colors.onBrand}
          />
        </View>
        <View style={[styles.prefRow, styles.prefRowSpaced]}>
          <View style={[styles.prefIcon, { backgroundColor: colors.surface2 }]}>
            <Ionicons name="moon-outline" size={18} color={colors.ink2} />
          </View>
          <View style={styles.prefBody}>
            <Text style={[styles.prefTitle, { color: colors.ink }]}>Appearance</Text>
            <Text style={[styles.prefHint, { color: colors.ink3 }]}>
              Follows your system light/dark setting
            </Text>
          </View>
        </View>
      </Card>

      {/* Security */}
      <SectionHeader title="SECURITY" />
      <Card>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: passwordOpen }}
          onPress={() => {
            setPasswordOpen((v) => !v);
            setPasswordSuccess(false);
          }}
          style={styles.prefRow}
        >
          <View style={[styles.prefIcon, { backgroundColor: colors.surface2 }]}>
            <Ionicons name="key-outline" size={18} color={colors.ink2} />
          </View>
          <View style={styles.prefBody}>
            <Text style={[styles.prefTitle, { color: colors.ink }]}>Change password</Text>
          </View>
          <Ionicons
            name={passwordOpen ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.ink3}
          />
        </Pressable>

        {passwordOpen ? (
          <View style={styles.passwordBlock}>
            {passwordError ? <Banner text={passwordError} tone="danger" /> : null}
            {passwordSuccess ? (
              <Banner text="Password updated. Other devices were signed out." tone="pos" />
            ) : null}
            <Input
              label="Current password"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              autoComplete="current-password"
              containerStyle={styles.field}
            />
            <Input
              label={`New password (min ${LIMITS.PASSWORD_MIN} characters)`}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoComplete="new-password"
              containerStyle={styles.field}
            />
            <Input
              label="Confirm new password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoComplete="new-password"
              error={
                confirmPassword.length > 0 && confirmPassword !== newPassword
                  ? 'Passwords do not match'
                  : null
              }
              containerStyle={styles.field}
            />
            <Button
              title="Update password"
              onPress={submitPassword}
              loading={changePassword.isPending}
              disabled={!passwordValid}
              fullWidth
            />
          </View>
        ) : null}
      </Card>

      {/* WI-068 §9.2 — danger zone separated by a hairline-strong divider,
          matching the web settings page's "danger zone" treatment. */}
      <View style={[styles.dangerZone, { borderTopColor: colors.hairlineStrong }]}>
        <Button
          title="Sign out"
          variant="destructive"
          icon="log-out-outline"
          onPress={confirmSignOut}
          fullWidth
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '700',
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  profileCard: {
    marginBottom: spacing.xs,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileBody: {
    flex: 1,
    minWidth: 0,
    marginLeft: spacing.md,
    marginRight: spacing.md,
  },
  profileName: {
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  profileEmail: {
    fontSize: fontSize.sm,
    marginTop: 1,
  },
  avatarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  editBlock: {
    marginTop: spacing.lg,
  },
  field: {
    marginBottom: spacing.lg,
  },
  swatchLabel: {
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginBottom: spacing.sm,
  },
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  banner: {
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  bannerText: {
    fontSize: fontSize.sm,
    fontWeight: '500',
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    // WI-068 §9.2/§12 — 44pt section rows (the "Change password" disclosure
    // row is the interactive one this floor actually gates; additive to
    // every other row here for consistency).
    minHeight: 44,
  },
  prefRowSpaced: {
    marginTop: spacing.lg,
  },
  prefIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  prefBody: {
    flex: 1,
    minWidth: 0,
    marginRight: spacing.md,
  },
  prefTitle: {
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  prefHint: {
    fontSize: fontSize.xs,
    marginTop: 1,
  },
  passwordBlock: {
    marginTop: spacing.lg,
  },
  dangerZone: {
    marginTop: spacing.xl,
    paddingTop: spacing.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
