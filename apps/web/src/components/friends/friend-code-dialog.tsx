'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { useFriendCode, useRotateFriendCode } from '@/lib/hooks';
import { copyToClipboard } from '@/lib/clipboard';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

export interface FriendCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * WI-040 (web half) — a persistent, regeneratable friend-add code: display,
 * copy, QR, regenerate. Reuses `qrcode.react`'s `QRCodeSVG`, the same
 * component `settle-dialog.tsx` already uses for its settle-up link/QR
 * (WI-016) — no second QR dependency. Web has no camera scan (mobile-only,
 * per spec-WI-040 D4); this is display/copy/regenerate only.
 */
export function FriendCodeDialog({ open, onOpenChange }: FriendCodeDialogProps) {
  const friendCode = useFriendCode();
  const rotateCode = useRotateFriendCode();
  const [copied, setCopied] = useState(false);
  const [rotateArmed, setRotateArmed] = useState(false);
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    setRotateArmed(false);
  }, [open]);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const handleCopy = async () => {
    if (!friendCode.data) return;
    const ok = await copyToClipboard(friendCode.data.shareUrl);
    if (ok) {
      setCopied(true);
      toast.success('Friend-add link copied');
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error('Could not copy automatically — select the link and copy it.');
    }
  };

  const handleRotate = () => {
    rotateCode.mutate(undefined, {
      onSuccess: () => {
        setRotateArmed(false);
        toast.success('Code regenerated', { description: 'The old code no longer works.' });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm" ariaLabel="Your friend-add code">
      <DialogHeader>
        <DialogTitle>Your friend-add code</DialogTitle>
        <DialogDescription>
          Share this code, link, or QR so someone can add you as a friend without your email.
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-4 pb-6">
        {friendCode.isLoading ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="mx-auto h-40 w-40" />
            <p className="text-center text-[13px] text-ink-3">Loading your code…</p>
          </div>
        ) : friendCode.isError || !friendCode.data ? (
          <p className="text-center text-sm text-ink-2">Couldn&rsquo;t load your code.</p>
        ) : (
          <>
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-lg bg-white p-2">
                <QRCodeSVG value={friendCode.data.shareUrl} size={160} />
              </div>
              <p className="font-mono text-lg font-semibold tracking-widest text-ink">
                {friendCode.data.code}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Input
                value={friendCode.data.shareUrl}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 font-mono text-[12px]"
                aria-label="Friend-add link"
              />
              <Button
                variant="secondary"
                onClick={() => void handleCopy()}
                aria-label="Copy friend-add link"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-pos" aria-hidden="true" />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden="true" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>

            {rotateArmed ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-warn-soft px-3 py-2">
                <p className="min-w-0 flex-1 text-[13px] text-warn">
                  The current code and link stop working immediately.
                </p>
                <Button
                  size="sm"
                  variant="danger"
                  loading={rotateCode.isPending}
                  onClick={handleRotate}
                >
                  Regenerate code
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={rotateCode.isPending}
                  onClick={() => setRotateArmed(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setRotateArmed(true)}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Regenerate code
              </button>
            )}
          </>
        )}
      </DialogBody>
    </Dialog>
  );
}
