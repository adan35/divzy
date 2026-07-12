'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-store';
import { FullPageSpinner } from '@/components/ui/spinner';

/** Root route: forward to the dashboard when authed, /login when a guest. */
export default function RootPage() {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authed') router.replace('/dashboard');
    else if (status === 'guest') router.replace('/login');
  }, [status, router]);

  return <FullPageSpinner />;
}
