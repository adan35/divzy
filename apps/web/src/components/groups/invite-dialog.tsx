'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Copy, RefreshCw, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { LIMITS, type GroupDto } from '@divzy/shared';
import { useAddMember, useRotateInviteCode } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: GroupDto;
  /** Admins may rotate the invite code. */
  isAdmin: boolean;
}

/**
 * Share the group invite link (copy / admin rotate) and add existing Divzy
 * users directly by email.
 */
export function InviteDialog({ open, onOpenChange, group, isAdmin }: InviteDialogProps) {
  const addMember = useAddMember();
  const rotateCode = useRotateInviteCode();

  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);
  const [rotateArmed, setRotateArmed] = useState(false);
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!open) return;
    setEmail('');
    setEmailTouched(false);
    setRotateArmed(false);
    setCopied(false);
  }, [open]);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const inviteLink = origin ? `${origin}/join/${group.inviteCode}` : `/join/${group.inviteCode}`;
  const emailValid = EMAIL_PATTERN.test(email.trim());
  const emailError =
    emailTouched && email.trim().length > 0 && !emailValid
      ? 'Enter a valid email address'
      : null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast.success('Invite link copied');
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy automatically — select the link and copy it.');
    }
  };

  const handleRotate = () => {
    rotateCode.mutate(group.id, {
      onSuccess: () => {
        setRotateArmed(false);
        toast.success('Invite link rotated', {
          description: 'The old link no longer works.',
        });
      },
    });
  };

  const handleAddByEmail = (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!emailValid || addMember.isPending) {
      setEmailTouched(true);
      return;
    }
    addMember.mutate(
      { groupId: group.id, email: value },
      {
        onSuccess: () => {
          toast.success(`Added ${value} to ${group.name}`);
          setEmail('');
          setEmailTouched(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="md" ariaLabel="Invite people">
      <DialogHeader>
        <DialogTitle>Invite to {group.name}</DialogTitle>
        <DialogDescription>Share the link, or add someone by email.</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-5 pb-6">
        <div className="space-y-1.5">
          <span className="block text-[13px] font-medium text-ink-2">Invite link</span>
          <div className="flex items-center gap-2">
            <Input
              value={inviteLink}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 font-mono text-[13px]"
              aria-label="Invite link"
            />
            <Button variant="secondary" onClick={() => void handleCopy()} aria-label="Copy invite link">
              {copied ? (
                <Check className="h-4 w-4 text-pos" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="text-[13px] text-ink-3">Anyone with this link can join the group.</p>
          {isAdmin &&
            (rotateArmed ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-warn-soft px-3 py-2">
                <p className="min-w-0 flex-1 text-[13px] text-warn">
                  The current link stops working immediately.
                </p>
                <Button
                  size="sm"
                  variant="danger"
                  loading={rotateCode.isPending}
                  onClick={handleRotate}
                >
                  Rotate link
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
                Rotate invite link
              </button>
            ))}
        </div>

        <div className="h-px bg-hairline" role="separator" />

        <form onSubmit={handleAddByEmail} noValidate className="space-y-1.5">
          <Field
            label="Add by email"
            error={emailError}
            hint="They need an existing Divzy account."
          >
            {(id) => (
              <div className="flex items-start gap-2">
                <Input
                  id={id}
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  value={email}
                  maxLength={LIMITS.EMAIL_MAX}
                  placeholder="friend@example.com"
                  invalid={emailError !== null}
                  disabled={addMember.isPending}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setEmailTouched(true)}
                  className="flex-1"
                />
                <Button
                  type="submit"
                  loading={addMember.isPending}
                  disabled={!emailValid}
                >
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  Add
                </Button>
              </div>
            )}
          </Field>
        </form>
      </DialogBody>
    </Dialog>
  );
}
