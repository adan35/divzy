'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { ApiError } from '@divzy/api-client';
import { LIMITS, zRegisterInput } from '@divzy/shared';
import { errorMessage, useRegister } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { CurrencySelect } from '@/components/ui/currency-select';
import { Field, Input } from '@/components/ui/input';

interface RegisterValues {
  name: string;
  email: string;
  password: string;
  confirm: string;
}

type FieldName = keyof RegisterValues;

type RegisterErrors = Partial<Record<FieldName, string>>;

function validate(values: RegisterValues): RegisterErrors {
  const errors: RegisterErrors = {};
  const name = values.name.trim();
  if (name.length === 0) {
    errors.name = 'Name is required.';
  } else if (name.length > LIMITS.NAME_MAX) {
    errors.name = `Name must be at most ${LIMITS.NAME_MAX} characters.`;
  }
  if (!zRegisterInput.shape.email.safeParse(values.email).success) {
    errors.email = values.email.trim()
      ? 'Enter a valid email address.'
      : 'Email is required.';
  }
  if (values.password.length < LIMITS.PASSWORD_MIN) {
    errors.password = `Password must be at least ${LIMITS.PASSWORD_MIN} characters.`;
  } else if (values.password.length > LIMITS.PASSWORD_MAX) {
    errors.password = `Password must be at most ${LIMITS.PASSWORD_MAX} characters.`;
  }
  if (values.confirm !== values.password) {
    errors.confirm = 'Passwords do not match.';
  }
  return errors;
}

const UNTOUCHED: Record<FieldName, boolean> = {
  name: false,
  email: false,
  password: false,
  confirm: false,
};

export default function RegisterPage() {
  const router = useRouter();
  const register = useRegister();

  const [values, setValues] = useState<RegisterValues>({
    name: '',
    email: '',
    password: '',
    confirm: '',
  });
  const [currency, setCurrency] = useState('USD');
  const [touched, setTouched] = useState(UNTOUCHED);
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const errors = validate(values);
  const isValid = Object.keys(errors).length === 0;

  const setValue = (key: FieldName, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setSubmitError(null);
  };

  const blur = (key: FieldName) => setTouched((t) => ({ ...t, [key]: true }));

  const fieldError = (key: FieldName): string | null =>
    touched[key] ? errors[key] ?? null : null;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched({ name: true, email: true, password: true, confirm: true });
    setSubmitError(null);
    if (values.confirm !== values.password || register.isPending) return;
    const parsed = zRegisterInput.safeParse({
      name: values.name,
      email: values.email,
      password: values.password,
      defaultCurrency: currency,
    });
    if (!parsed.success) return;
    register.mutate(parsed.data, {
      onSuccess: () => router.replace('/dashboard'),
      onError: (error) => {
        setSubmitError(
          error instanceof ApiError && error.statusCode === 409
            ? 'That email is already registered — try logging in instead.'
            : errorMessage(error),
        );
      },
    });
  };

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-ink">Create your account</h1>
      <p className="mt-1 text-sm text-ink-2">
        Free forever — split expenses in minutes.
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        <Field label="Name" error={fieldError('name')}>
          {(id) => (
            <Input
              id={id}
              type="text"
              autoComplete="name"
              autoFocus
              placeholder="Your name"
              maxLength={LIMITS.NAME_MAX}
              value={values.name}
              invalid={touched.name && Boolean(errors.name)}
              onChange={(e) => setValue('name', e.target.value)}
              onBlur={() => blur('name')}
            />
          )}
        </Field>

        <Field label="Email" error={fieldError('email')}>
          {(id) => (
            <Input
              id={id}
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={values.email}
              invalid={touched.email && Boolean(errors.email)}
              onChange={(e) => setValue('email', e.target.value)}
              onBlur={() => blur('email')}
            />
          )}
        </Field>

        <Field
          label="Password"
          error={fieldError('password')}
          hint={
            touched.password ? undefined : `At least ${LIMITS.PASSWORD_MIN} characters.`
          }
        >
          {(id) => (
            <div className="relative">
              <Input
                id={id}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Choose a password"
                className="pr-11"
                value={values.password}
                invalid={touched.password && Boolean(errors.password)}
                onChange={(e) => setValue('password', e.target.value)}
                onBlur={() => blur('password')}
              />
              <button
                type="button"
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((s) => !s)}
                // WI-068 AC-10b (defect-WI-068-1): 44x44 hit area (spec §12)
                // filling the input's `pr-11` reservation; glyph stays 16px.
                // Absolutely positioned, so no layout shift.
                className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-[10px] text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          )}
        </Field>

        <Field label="Confirm password" error={fieldError('confirm')}>
          {(id) => (
            <Input
              id={id}
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="Repeat your password"
              value={values.confirm}
              invalid={touched.confirm && Boolean(errors.confirm)}
              onChange={(e) => setValue('confirm', e.target.value)}
              onBlur={() => blur('confirm')}
            />
          )}
        </Field>

        <Field label="Default currency" hint="Used for new groups and expenses.">
          {(id) => <CurrencySelect id={id} value={currency} onChange={setCurrency} />}
        </Field>

        {submitError && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-[10px] bg-neg-soft px-3.5 py-2.5 text-sm text-danger"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {submitError}
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={!isValid}
          loading={register.isPending}
        >
          Create account
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-2">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-brand hover:text-brand-hover">
          Log in
        </Link>
      </p>
    </div>
  );
}
