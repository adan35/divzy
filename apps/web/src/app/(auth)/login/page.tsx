'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { ApiError } from '@divzy/api-client';
import { zLoginInput } from '@divzy/shared';
import { errorMessage, useLogin } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

interface LoginValues {
  email: string;
  password: string;
}

interface LoginErrors {
  email?: string;
  password?: string;
}

function validate(values: LoginValues): LoginErrors {
  const errors: LoginErrors = {};
  if (!zLoginInput.shape.email.safeParse(values.email).success) {
    errors.email = values.email.trim()
      ? 'Enter a valid email address.'
      : 'Email is required.';
  }
  if (values.password.length === 0) {
    errors.password = 'Password is required.';
  }
  return errors;
}

export default function LoginPage() {
  const router = useRouter();
  const login = useLogin();

  const [values, setValues] = useState<LoginValues>({ email: '', password: '' });
  const [touched, setTouched] = useState<{ email: boolean; password: boolean }>({
    email: false,
    password: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const errors = validate(values);
  const isValid = Object.keys(errors).length === 0;

  const setValue = (key: keyof LoginValues, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setSubmitError(null);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched({ email: true, password: true });
    setSubmitError(null);
    const parsed = zLoginInput.safeParse(values);
    if (!parsed.success || login.isPending) return;
    login.mutate(parsed.data, {
      onSuccess: () => router.replace('/dashboard'),
      onError: (error) => {
        setSubmitError(
          error instanceof ApiError && error.statusCode === 401
            ? 'Wrong email or password.'
            : errorMessage(error),
        );
      },
    });
  };

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-ink">Welcome back</h1>
      <p className="mt-1 text-sm text-ink-2">Log in to your divzy account.</p>

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        <Field label="Email" error={touched.email ? errors.email ?? null : null}>
          {(id) => (
            <Input
              id={id}
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              value={values.email}
              invalid={touched.email && Boolean(errors.email)}
              onChange={(e) => setValue('email', e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            />
          )}
        </Field>

        <Field label="Password" error={touched.password ? errors.password ?? null : null}>
          {(id) => (
            <div className="relative">
              <Input
                id={id}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Your password"
                className="pr-11"
                value={values.password}
                invalid={touched.password && Boolean(errors.password)}
                onChange={(e) => setValue('password', e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, password: true }))}
              />
              <button
                type="button"
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
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

        {submitError && (
          <p
            role="alert"
            className="rounded-[10px] bg-neg-soft px-3.5 py-2.5 text-sm text-danger"
          >
            {submitError}
          </p>
        )}

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={!isValid}
          loading={login.isPending}
        >
          Log in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-2">
        New to divzy?{' '}
        <Link href="/register" className="font-medium text-brand hover:text-brand-hover">
          Create an account
        </Link>
      </p>
    </div>
  );
}
