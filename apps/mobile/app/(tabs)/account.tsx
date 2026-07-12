import { useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { AVATAR_COLORS, LIMITS } from '@divzy/shared';
import {
  Avatar,
  Button,
  Card,
  CurrencyPicker,
  Input,
  ListItem,
  Screen,
  SectionHeader,
} from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorMessage, useChangePassword, useUpdateMe } from '@/lib/hooks';
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
  const router = useRouter();
  const { colors } = useTheme();
  const { user, signOut } = useAuth();

  const profileMutation = useUpdateMe();
  const currencyMutation = useUpdateMe();
  const notificationsMutation = useUpdateMe();
  const changePassword = useChangePassword();

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
    Alert.alert('Sign out?', 'You can log back in anytime.', [
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
                    {selected ? <Ionicons name="checkmark" size={16} color="#ffffff" /> : null}
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
            thumbColor="#ffffff"
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

      {/* Features */}
      <SectionHeader title="MORE" />
      <Card padded={false} style={styles.listCard}>
        <ListItem
          title="Recurring expenses"
          subtitle="Rent, subscriptions and other repeating bills"
          icon="repeat-outline"
          chevron
          onPress={() => router.push('/recurring')}
        />
        <View style={[styles.separator, { backgroundColor: colors.hairline }]} />
        <ListItem
          title="Analytics"
          subtitle="Where your money goes"
          icon="bar-chart-outline"
          chevron
          onPress={() => router.push('/analytics')}
        />
        <View style={[styles.separator, { backgroundColor: colors.hairline }]} />
        <ListItem
          title="Activity"
          subtitle="Everything that happened across your groups"
          icon="pulse-outline"
          chevron
          onPress={() => router.push('/activity')}
        />
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

      <Button
        title="Sign out"
        variant="destructive"
        icon="log-out-outline"
        onPress={confirmSignOut}
        fullWidth
        style={styles.signOut}
      />
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
  listCard: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 56,
  },
  passwordBlock: {
    marginTop: spacing.lg,
  },
  signOut: {
    marginTop: spacing.xl,
  },
});
