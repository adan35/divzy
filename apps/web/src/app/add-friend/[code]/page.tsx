'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowRight, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import type { FriendDto } from '@divzy/shared';
import { errorMessage, useAddFriendByCode } from '@/lib/hooks';
import { useAuth } from '@/lib/auth-store';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FullPageSpinner } from '@/components/ui/spinner';

/** Where a guest's friend code waits while they log in / register. */
const PENDING_ADD_FRIEND_CODE_KEY = 'divzy:pending-add-friend-code';

/**
 * WI-040 D3 — share-link landing page for an incoming friend-add code.
 * Mirrors `/join/[code]`'s shape exactly: guests are bounced to /login with
 * the code parked in sessionStorage and a ?next= return path; authed users
 * confirm with one tap. Resolves via the standard POST /friends/add-by-code
 * flow (same friendship semantics as POST /friends).
 */
export default function AddFriendByCodePage() {
  const params = useParams<{ code: string }>();
  const rawCode = typeof params.code === 'string' ? params.code : '';
  const code = decodeURIComponent(rawCode).trim();

  const router = useRouter();
  const { status } = useAuth();
  const addFriendByCode = useAddFriendByCode();
  const [added, setAdded] = useState<FriendDto | null>(null);

  const codeLooksValid = code.length >= 4 && code.length <= 32;

  useEffect(() => {
    if (status !== 'guest') return;
    try {
      sessionStorage.setItem(PENDING_ADD_FRIEND_CODE_KEY, code);
    } catch {
      // Storage unavailable (private mode) — the ?next= param still brings them back.
    }
    router.replace(`/login?next=${encodeURIComponent(`/add-friend/${code}`)}`);
  }, [status, code, router]);

  if (status !== 'authed') {
    return <FullPageSpinner />;
  }

  const handleAdd = () => {
    if (addFriendByCode.isPending) return;
    addFriendByCode.mutate(code, {
      onSuccess: (friend) => {
        setAdded(friend);
        try {
          sessionStorage.removeItem(PENDING_ADD_FRIEND_CODE_KEY);
        } catch {
          // Nothing parked — fine.
        }
        toast.success(`👥 ${friend.user.name} is now your friend`);
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
            <h1 className="mt-3 text-lg font-semibold text-ink">This link looks broken</h1>
            <p className="mt-1 text-sm text-ink-2">Ask for a fresh link and try again.</p>
            <Button className="mt-6 w-full" onClick={() => router.push('/dashboard')}>
              Go to dashboard
            </Button>
          </>
        ) : added ? (
          <>
            <Avatar user={added.user} size="lg" className="mx-auto" />
            <h1 className="mt-3 text-lg font-semibold text-ink">You&rsquo;re friends now!</h1>
            <p className="mt-1 text-sm text-ink-2">{added.user.name} is now in your friends list.</p>
            <Button
              className="mt-6 w-full"
              onClick={() => router.push(`/friends/${added.user.id}`)}
            >
              Go to {added.user.name}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Link
              href="/friends"
              className="mt-3 inline-block text-[13px] font-medium text-ink-3 transition-colors hover:text-ink"
            >
              Back to friends
            </Link>
          </>
        ) : (
          <>
            <div className="text-4xl" aria-hidden="true">
              🤝
            </div>
            <h1 className="mt-3 text-lg font-semibold text-ink">Add a friend</h1>
            <p className="mt-1 text-sm text-ink-2">
              Someone shared their Divzy friend-add code with you.
            </p>
            <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm uppercase tracking-[0.2em] text-ink">
              {code}
            </p>
            {addFriendByCode.isError && (
              <p className="mt-3 text-[13px] text-danger" role="alert">
                {errorMessage(addFriendByCode.error)}
              </p>
            )}
            <Button className="mt-6 w-full" loading={addFriendByCode.isPending} onClick={handleAdd}>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Add friend
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
