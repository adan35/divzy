'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth-store';
import { Card } from '@/components/ui/card';
import { FullPageSpinner } from '@/components/ui/spinner';

/**
 * Auth shell: centered card on the page background with the divzy wordmark.
 * Already-authenticated users are forwarded straight to the dashboard.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authed') router.replace('/dashboard');
  }, [status, router]);

  // While the silent session restore runs (or right before the redirect
  // lands), show the brand spinner instead of flashing the form.
  if (status !== 'guest') return <FullPageSpinner />;

  return (
    <div
      data-testid="auth-shell"
      className="flex min-h-screen flex-col items-center justify-center bg-page px-4 py-10"
      // WI-068 §9.1: subtle radial brand-soft wash behind the card (CSS
      // only — no new deps). `bg-page` still shows through outside the
      // gradient's reach.
      style={{
        backgroundImage:
          'radial-gradient(ellipse 60% 50% at 50% 0%, var(--brand-soft), transparent 70%)',
      }}
    >
      <span className="mb-6 select-none text-3xl font-bold lowercase tracking-tight text-ink">
        divzy
        <span className="text-accent">.</span>
      </span>
      <Card
        data-testid="auth-card"
        className="w-full max-w-[420px] bg-elevated p-6 shadow-pop dark:shadow-top-edge sm:p-8"
      >
        {children}
      </Card>
      <p className="mt-6 text-center text-[13px] text-ink-3">
        Split expenses, stay friends.
      </p>
    </div>
  );
}
