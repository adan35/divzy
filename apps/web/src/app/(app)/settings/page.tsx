'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, LogOut, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import {
  AVATAR_COLORS,
  LIMITS,
  zPhone,
  type NotificationCategory,
  type NotificationPreferenceDto,
} from '@divzy/shared';
import {
  useChangePassword,
  useLogout,
  useNotificationPreferences,
  useUpdateMe,
  useUpdateNotificationPreference,
  useUploadAvatar,
} from '@/lib/hooks';
import { useAuth } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CurrencySelect } from '@/components/ui/currency-select';
import { Field, Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton, SkeletonList } from '@/components/ui/skeleton';

// ---------------------------------------------------------------------------
// Avatar upload — client-side pre-validation (fast feedback; the server is
// the authoritative enforcer of both constraints — defense in depth).
// ---------------------------------------------------------------------------

const AVATAR_ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];
const AVATAR_MAX_BYTES = 10 * 1024 * 1024; // 10MB, mirrors MAX_UPLOAD_MB default.

// ---------------------------------------------------------------------------
// Small local switch (token-styled, accessible).
// ---------------------------------------------------------------------------

function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors',
        checked ? 'bg-brand' : 'bg-hairline',
        disabled && 'cursor-not-allowed opacity-55',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
          checked && 'translate-x-5',
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function ProfileSection() {
  const { user } = useAuth();
  const updateMe = useUpdateMe();
  // Own mutation instances for the avatar controls — deliberately NOT shared
  // with `updateMe` above, so an in-flight profile-form save never disables
  // the avatar controls and vice versa (DRB security condition, WI-035 §4 —
  // "one mutation instance per independent control", same principle as the
  // WI-022 stale-balance-reminders toggle).
  const avatarUpload = useUploadAvatar();
  const avatarUpdateMe = useUpdateMe();
  // Own mutation instance for the phone field (WI-045) — independently
  // submitted from both the name/avatarColor/currency form and the avatar
  // controls, so a pending/failed phone save never disables either of those
  // (same "one mutation instance per independent control" principle as the
  // avatar controls above).
  const phoneUpdateMe = useUpdateMe();
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(user?.name ?? '');
  const [avatarColor, setAvatarColor] = useState(user?.avatarColor ?? AVATAR_COLORS[0]);
  const [defaultCurrency, setDefaultCurrency] = useState(user?.defaultCurrency ?? 'USD');
  const [nameTouched, setNameTouched] = useState(false);
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [phoneTouched, setPhoneTouched] = useState(false);

  // Adopt server-side profile changes (e.g. saved from another tab).
  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setAvatarColor(user.avatarColor);
    setDefaultCurrency(user.defaultCurrency);
    setPhone(user.phone ?? '');
  }, [user]);

  if (!user) return null;

  const trimmedName = name.trim();
  const nameValid = trimmedName.length > 0 && trimmedName.length <= LIMITS.NAME_MAX;
  const nameError = nameTouched && !nameValid ? 'Enter a name' : null;
  const dirty =
    trimmedName !== user.name ||
    avatarColor !== user.avatarColor ||
    defaultCurrency !== user.defaultCurrency;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setNameTouched(true);
    if (!nameValid || !dirty || updateMe.isPending) return;
    updateMe.mutate(
      {
        ...(trimmedName !== user.name ? { name: trimmedName } : {}),
        ...(avatarColor !== user.avatarColor ? { avatarColor } : {}),
        ...(defaultCurrency !== user.defaultCurrency ? { defaultCurrency } : {}),
      },
      { onSuccess: () => toast.success('Profile updated') },
    );
  };

  const avatarPending = avatarUpload.isPending || avatarUpdateMe.isPending;

  const handleAvatarFile = (file: File) => {
    setAvatarError(null);
    if (!AVATAR_ACCEPTED_TYPES.includes(file.type)) {
      setAvatarError('Please choose a JPEG, PNG, WEBP, HEIC or HEIF image.');
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError('Image must be 10MB or smaller.');
      return;
    }
    avatarUpload.mutate(file, {
      onSuccess: (res) => {
        avatarUpdateMe.mutate(
          { avatarUrl: res.url },
          { onSuccess: () => toast.success('Profile photo updated') },
        );
      },
      onError: () => setAvatarError('Upload failed. Please try again.'),
    });
  };

  const handleRemoveAvatar = () => {
    setAvatarError(null);
    avatarUpdateMe.mutate(
      { avatarUrl: null },
      { onSuccess: () => toast.success('Profile photo removed') },
    );
  };

  // Phone (WI-045) — optional, independently-submitted. Empty clears it
  // (sends `null`); a non-empty value must parse as a valid E.164-ish phone
  // via the shared `zPhone` (never a hand-rolled regex). Errors (including
  // 409 PHONE_TAKEN) surface through `useUpdateMe()`'s own default
  // `onError: toastError` — this section adds no extra error handling.
  const trimmedPhone = phone.trim();
  const phoneParsed = trimmedPhone === '' ? null : zPhone.safeParse(trimmedPhone);
  const phoneValid = trimmedPhone === '' || (phoneParsed?.success ?? false);
  const phoneError = phoneTouched && !phoneValid ? 'Enter a valid phone number, e.g. +14155552671.' : null;
  const phoneDirty = trimmedPhone !== (user.phone ?? '');

  const handlePhoneSave = () => {
    setPhoneTouched(true);
    if (!phoneValid || !phoneDirty || phoneUpdateMe.isPending) return;
    const nextPhone = phoneParsed && phoneParsed.success ? phoneParsed.data : null;
    phoneUpdateMe.mutate(
      { phone: nextPhone },
      {
        onSuccess: () =>
          toast.success(nextPhone === null ? 'Phone number removed' : 'Phone number updated'),
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar
              user={{ name: trimmedName || user.name, avatarColor, avatarUrl: user.avatarUrl }}
              size="lg"
            />
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={avatarPending}
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {user.avatarUrl ? 'Change photo' : 'Upload photo'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!user.avatarUrl || avatarPending}
                  onClick={handleRemoveAvatar}
                >
                  Remove
                </Button>
              </div>
              {avatarError && (
                <p role="alert" className="text-[13px] text-danger">
                  {avatarError}
                </p>
              )}
              <input
                ref={avatarInputRef}
                type="file"
                className="hidden"
                accept={AVATAR_ACCEPTED_TYPES.join(',')}
                aria-label="Upload profile photo"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) handleAvatarFile(file);
                }}
              />
            </div>
            <div
              role="radiogroup"
              aria-label="Avatar color"
              className="flex flex-wrap items-center gap-2"
            >
              {AVATAR_COLORS.map((color) => {
                const selected = color === avatarColor;
                return (
                  <button
                    key={color}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`Avatar color ${color}`}
                    onClick={() => setAvatarColor(color)}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-105',
                      selected && 'ring-2 ring-brand ring-offset-2 ring-offset-surface',
                    )}
                    style={{ backgroundColor: color }}
                  >
                    {selected && <Check className="h-4 w-4 text-white" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" error={nameError} required>
              {(id) => (
                <Input
                  id={id}
                  value={name}
                  maxLength={LIMITS.NAME_MAX}
                  invalid={nameError !== null}
                  disabled={updateMe.isPending}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setNameTouched(true)}
                />
              )}
            </Field>
            <Field label="Default currency" hint="Used for new expenses and analytics.">
              {(id) => (
                <CurrencySelect
                  id={id}
                  value={defaultCurrency}
                  disabled={updateMe.isPending}
                  onChange={setDefaultCurrency}
                />
              )}
            </Field>
          </div>

          <Field label="Email" hint="Your sign-in email can't be changed.">
            {(id) => <Input id={id} value={user.email} disabled readOnly />}
          </Field>

          <div className="flex justify-end">
            <Button type="submit" loading={updateMe.isPending} disabled={!dirty || !nameValid}>
              Save changes
            </Button>
          </div>
        </form>

        <div className="mt-4 border-t border-hairline pt-4">
          <Field
            label="Phone"
            error={phoneError}
            hint={phoneError ? undefined : "Optional — lets you log in with your phone number too."}
          >
            {(id) => (
              <div className="flex items-center gap-2">
                <Input
                  id={id}
                  type="tel"
                  placeholder="+14155552671"
                  maxLength={LIMITS.PHONE_MAX}
                  value={phone}
                  invalid={phoneError !== null}
                  disabled={phoneUpdateMe.isPending}
                  onChange={(e) => setPhone(e.target.value)}
                  onBlur={() => setPhoneTouched(true)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={phoneUpdateMe.isPending}
                  disabled={!phoneDirty || !phoneValid}
                  onClick={handlePhoneSave}
                >
                  Save
                </Button>
              </div>
            )}
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

function NotificationsSection() {
  const { user } = useAuth();
  const updateMe = useUpdateMe();
  const remindersMutation = useUpdateMe();

  if (!user) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ink">Email notifications</p>
            <p className="mt-0.5 text-[13px] text-ink-3">
              New expenses, payments and comments that involve you.
            </p>
          </div>
          <Switch
            label="Email notifications"
            checked={user.emailNotifications}
            disabled={updateMe.isPending}
            onChange={(next) =>
              updateMe.mutate(
                { emailNotifications: next },
                {
                  onSuccess: () =>
                    toast.success(next ? 'Email notifications on' : 'Email notifications off'),
                },
              )
            }
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ink">Stale balance reminders</p>
            <p className="mt-0.5 text-[13px] text-ink-3">
              Get a reminder email when a balance has been outstanding for a while.
            </p>
          </div>
          <Switch
            label="Stale balance reminders"
            checked={user.staleBalanceRemindersEnabled}
            disabled={remindersMutation.isPending}
            onChange={(next) =>
              remindersMutation.mutate(
                { staleBalanceRemindersEnabled: next },
                {
                  onSuccess: () =>
                    toast.success(
                      next ? 'Stale balance reminders on' : 'Stale balance reminders off',
                    ),
                },
              )
            }
          />
        </div>

        <NotificationCategoriesMatrix />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Notification categories matrix (WI-041, auth's slice)
// ---------------------------------------------------------------------------

const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  EXPENSE_ADDED: 'Expense added',
  EXPENSE_EDITED: 'Expense edited',
  EXPENSE_DELETED: 'Expense deleted',
  COMMENT: 'Comments',
  PAYMENT_RECEIVED: 'Payment received',
  GROUP_INVITE: 'Group invites',
  EXPENSE_DUE: 'Expense due',
  MONTHLY_SUMMARY: 'Monthly summary',
  PRODUCT_NEWS: 'Product news',
};

function NotificationCategoriesMatrix() {
  const prefsQuery = useNotificationPreferences();

  return (
    <div className="border-t border-hairline pt-4">
      <p className="text-sm font-medium text-ink">Notification categories</p>
      <p className="mt-0.5 text-[13px] text-ink-3">
        Choose which events send you a push or email notification.
      </p>

      {prefsQuery.isLoading && <SkeletonList rows={3} avatar={false} className="mt-3" />}

      {prefsQuery.isError && (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          Couldn&apos;t load notification preferences. Please refresh and try again.
        </p>
      )}

      {prefsQuery.data && (
        <div className="mt-3">
          <div className="grid grid-cols-[1fr,auto,auto] items-center gap-4 pb-2 text-[11px] font-medium uppercase tracking-wide text-ink-3">
            <span>Category</span>
            <span>Push</span>
            <span>Email</span>
          </div>
          <div className="divide-y divide-hairline">
            {prefsQuery.data.categories.map((pref) => (
              <NotificationCategoryRow key={pref.category} pref={pref} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationCategoryRow({ pref }: { pref: NotificationPreferenceDto }) {
  // Own mutation instance per toggle (not per row) — a push toggle saving
  // must never disable its row's email toggle, or any other row's toggles
  // (DRB security condition, same "one mutation instance per control"
  // principle as the WI-035 avatar controls).
  const pushMutation = useUpdateNotificationPreference();
  const emailMutation = useUpdateNotificationPreference();

  const label = NOTIFICATION_CATEGORY_LABELS[pref.category];
  const disabled = !pref.available;

  return (
    <div className="grid grid-cols-[1fr,auto,auto] items-center gap-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink">{label}</span>
        {disabled && <Badge>Coming soon</Badge>}
      </div>
      <Switch
        label={`${label} push notifications`}
        checked={pref.pushEnabled}
        disabled={disabled || pushMutation.isPending}
        onChange={(next) =>
          !disabled && pushMutation.mutate({ category: pref.category, pushEnabled: next })
        }
      />
      <Switch
        label={`${label} email notifications`}
        checked={pref.emailEnabled}
        disabled={disabled || emailMutation.isPending}
        onChange={(next) =>
          !disabled && emailMutation.mutate({ category: pref.category, emailEnabled: next })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

function SecuritySection() {
  const changePassword = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState({ current: false, next: false, confirm: false });

  const currentError = touched.current && current.length === 0 ? 'Enter your current password' : null;
  const nextError =
    touched.next && next.length < LIMITS.PASSWORD_MIN
      ? `At least ${LIMITS.PASSWORD_MIN} characters`
      : null;
  const confirmError = touched.confirm && confirm !== next ? 'Passwords don’t match' : null;
  const valid =
    current.length > 0 &&
    next.length >= LIMITS.PASSWORD_MIN &&
    next.length <= LIMITS.PASSWORD_MAX &&
    confirm === next;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched({ current: true, next: true, confirm: true });
    if (!valid || changePassword.isPending) return;
    changePassword.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          toast.success('Password changed — other devices were signed out.');
          setCurrent('');
          setNext('');
          setConfirm('');
          setTouched({ current: false, next: false, confirm: false });
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Security</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <Field label="Current password" error={currentError} required>
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="current-password"
                value={current}
                invalid={currentError !== null}
                disabled={changePassword.isPending}
                onChange={(e) => setCurrent(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, current: true }))}
              />
            )}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="New password" error={nextError} required>
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  invalid={nextError !== null}
                  disabled={changePassword.isPending}
                  onChange={(e) => setNext(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, next: true }))}
                />
              )}
            </Field>
            <Field label="Confirm new password" error={confirmError} required>
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  invalid={confirmError !== null}
                  disabled={changePassword.isPending}
                  onChange={(e) => setConfirm(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
                />
              )}
            </Field>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={changePassword.isPending} disabled={!valid}>
              Change password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

const THEME_OPTIONS: ReadonlyArray<{ value: string; label: string; icon: LucideIcon }> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <CardContent>
        {!mounted ? (
          <div className="grid grid-cols-3 gap-3" aria-hidden="true">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : (
          <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-3">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
              const selected = (theme ?? 'system') === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setTheme(value)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-xl border px-3 py-4 text-[13px] font-medium transition-colors',
                    selected
                      ? 'border-brand bg-brand-soft text-brand'
                      : 'border-hairline text-ink-2 hover:bg-surface-2 hover:text-ink',
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

// WI-068 §9.1: the page's one destructive-adjacent action — separated with
// the stronger `hairline-strong` border and a danger-styled (not neutral
// outline) control, per the spec's "danger zone" punch-list item. The
// sign-out action/copy itself (WI-034) is untouched.
function SessionSection() {
  const logout = useLogout();
  const router = useRouter();

  const handleLogout = async () => {
    await logout.mutateAsync();
    router.replace('/login');
  };

  return (
    <Card className="border-hairline-strong">
      <CardHeader>
        <CardTitle>Session</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-2">Sign out of this device.</p>
          <Button
            variant="ghost"
            className="text-danger hover:bg-neg-soft hover:text-danger"
            loading={logout.isPending}
            onClick={() => void handleLogout()}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Log out
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" subtitle="Your profile, preferences and security." />
      <div className="mx-auto max-w-2xl space-y-5">
        <ProfileSection />
        <NotificationsSection />
        <SecuritySection />
        <AppearanceSection />
        <SessionSection />
      </div>
    </>
  );
}
