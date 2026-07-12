'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowRight, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { GroupDto } from '@divzy/shared';
import { errorMessage, useJoinGroup } from '@/lib/hooks';
import { useAuth } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FullPageSpinner } from '@/components/ui/spinner';

/** Where a guest's invite code waits while they log in / register. */
const PENDING_JOIN_CODE_KEY = 'divzy:pending-join-code';

/**
 * Invite landing page (standalone — no app shell). Guests are bounced to
 * /login with the code parked in sessionStorage and a ?next= return path;
 * authed users confirm with one tap.
 */
export default function JoinPage() {
  const params = useParams<{ code: string }>();
  const rawCode = typeof params.code === 'string' ? params.code : '';
  const code = decodeURIComponent(rawCode).trim();

  const router = useRouter();
  const { status } = useAuth();
  const joinGroup = useJoinGroup();
  const [joined, setJoined] = useState<GroupDto | null>(null);

  const codeLooksValid = code.length >= 4 && code.length <= 32;

  // Guests: park the code and go log in; come back here afterwards.
  useEffect(() => {
    if (status !== 'guest') return;
    try {
      sessionStorage.setItem(PENDING_JOIN_CODE_KEY, code);
    } catch {
      // Storage unavailable (private mode) — the ?next= param still brings them back.
    }
    router.replace(`/login?next=${encodeURIComponent(`/join/${code}`)}`);
  }, [status, code, router]);

  if (status !== 'authed') {
    return <FullPageSpinner />;
  }

  const handleJoin = () => {
    if (joinGroup.isPending) return;
    joinGroup.mutate(code, {
      onSuccess: (group) => {
        setJoined(group);
        try {
          sessionStorage.removeItem(PENDING_JOIN_CODE_KEY);
        } catch {
          // Nothing parked — fine.
        }
        toast.success(`🎉 Welcome to ${group.name}`);
      },
    });
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-page px-4 py-10">
      <Link
        href="/dashboard"
        className="mb-6 select-none text-2xl font-bold lowercase tracking-tight text-brand"
      >
        divzy
      </Link>

      <Card className="w-full max-w-md p-8 text-center">
        {!codeLooksValid ? (
          <>
            <div className="text-4xl" aria-hidden="true">
              🔗
            </div>
            <h1 className="mt-3 text-lg font-semibold text-ink">
              This invite link looks broken
            </h1>
            <p className="mt-1 text-sm text-ink-2">
              Ask for a fresh link and try again.
            </p>
            <Button className="mt-6 w-full" onClick={() => router.push('/dashboard')}>
              Go to dashboard
            </Button>
          </>
        ) : joined ? (
          <>
            <div className="text-4xl" aria-hidden="true">
              {joined.emoji}
            </div>
            <h1 className="mt-3 text-lg font-semibold text-ink">You&rsquo;re in!</h1>
            <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-ink-2">
              <Users className="h-4 w-4" aria-hidden="true" />
              {joined.name} · {joined.members.length} member
              {joined.members.length === 1 ? '' : 's'}
            </p>
            <Button className="mt-6 w-full" onClick={() => router.push(`/groups/${joined.id}`)}>
              Go to {joined.name}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Link
              href="/dashboard"
              className="mt-3 inline-block text-[13px] font-medium text-ink-3 transition-colors hover:text-ink"
            >
              Back to dashboard
            </Link>
          </>
        ) : (
          <>
            <div className="text-4xl" aria-hidden="true">
              🎟️
            </div>
            <h1 className="mt-3 text-lg font-semibold text-ink">Join a group</h1>
            <p className="mt-1 text-sm text-ink-2">
              You&rsquo;ve been invited to a group on Divzy. Expenses, balances and
              settle-ups — all shared with you.
            </p>
            <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm uppercase tracking-[0.2em] text-ink">
              {code}
            </p>
            {joinGroup.isError && (
              <p className="mt-3 text-[13px] text-danger" role="alert">
                {errorMessage(joinGroup.error)}
              </p>
            )}
            <Button
              className="mt-6 w-full"
              loading={joinGroup.isPending}
              onClick={handleJoin}
            >
              Join group
            </Button>
            <Link
              href="/dashboard"
              className="mt-3 inline-block text-[13px] font-medium text-ink-3 transition-colors hover:text-ink"
            >
              Not now
            </Link>
          </>
        )}
      </Card>
    </main>
  );
}
