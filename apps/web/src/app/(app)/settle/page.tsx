'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SettleUpDialog, type SettleUpPrefill } from '@/components/settle/settle-dialog';
import { FullPageSpinner } from '@/components/ui/spinner';

/**
 * WI-016 Part B (ADR-013) — the web link target for the shareable settle-up
 * link/QR. No new endpoint, no server state: this page only reads the
 * non-secret prefill query params the link carries — the same shape mobile's
 * existing `app/settle.tsx` already consumes — and renders the real
 * `SettleUpDialog` open + pre-scoped. `POST /settlements` remains the sole
 * authority (party 403, membership 404, ADR-010/ADR-011 balance bound); this
 * page performs no validation beyond "is this a well-formed prefill" and
 * never records anything itself.
 *
 * Auth: this route lives under the `(app)` group, so the existing
 * `(app)/layout.tsx` guard (`status === 'guest' -> router.replace('/login')`)
 * already applies unmodified — no new redirect logic here, per ADR-013 /
 * spec-WI-016 Part B.
 */
function parsePrefillAmount(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function SettlePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const fromUserId = searchParams.get('fromUserId');
  const toUserId = searchParams.get('toUserId');
  const currency = searchParams.get('currency');
  const groupId = searchParams.get('groupId') ?? undefined;
  const amount = parsePrefillAmount(searchParams.get('amount'));

  const prefill: SettleUpPrefill | undefined =
    fromUserId && toUserId && currency && amount !== null
      ? { fromUserId, toUserId, amount, currency }
      : undefined;

  return (
    <SettleUpDialog
      open
      onOpenChange={(open) => {
        if (!open) router.push('/dashboard');
      }}
      groupId={groupId}
      prefill={prefill}
    />
  );
}

export default function SettlePage() {
  // useSearchParams requires a Suspense boundary during prerender (matches
  // the existing pattern in app/(app)/groups/page.tsx).
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <SettlePageInner />
    </Suspense>
  );
}
