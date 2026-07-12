'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Check, LogOut, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { AVATAR_COLORS, LIMITS } from '@divzy/shared';
import { useChangePassword, useLogout, useUpdateMe } from '@/lib/hooks';
import { useAuth } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CurrencySelect } from '@/components/ui/currency-select';
import { Field, Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';

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

  const [name, setName] = useState(user?.name ?? '');
  const [avatarColor, setAvatarColor] = useState(user?.avatarColor ?? AVATAR_COLORS[0]);
  const [defaultCurrency, setDefaultCurrency] = useState(user?.defaultCurrency ?? 'USD');
  const [nameTouched, setNameTouched] = useState(false);

  // Adopt server-side profile changes (e.g. saved from another tab).
  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setAvatarColor(user.avatarColor);
    setDefaultCurrency(user.defaultCurrency);
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar user={{ name: trimmedName || user.name, avatarColor }} size="lg" />
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

  if (!user) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
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

function SessionSection() {
  const logout = useLogout();
  const router = useRouter();

  const handleLogout = async () => {
    await logout.mutateAsync();
    router.replace('/login');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Session</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-2">
            Sign out on this device. Your data stays right where it is.
          </p>
          <Button
            variant="outline"
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
