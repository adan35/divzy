'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Check, Copy, RefreshCw, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { LIMITS, type GroupDto } from '@divzy/shared';
import { useAddMember, useAddMemberByFriend, useFriends, useRotateInviteCode } from '@/lib/hooks';
import { Avatar } from '@/components/ui/avatar';
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

/**
 * Legacy copy fallback for when `navigator.clipboard` (or its `writeText`
 * method) is unavailable — non-secure context, embedded webview, or an
 * iframe without clipboard-write permission. `execCommand` is deprecated but
 * remains the only synchronous, no-permission-prompt copy path in that case.
 * Browser-DOM-only utility — stays local to this file, not `packages/shared`.
 */
function copyViaFallback(text: string): void {
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  el.setSelectionRange(0, text.length);
  try {
    const ok = document.execCommand('copy');
    if (!ok) throw new Error('execCommand(copy) returned false');
  } finally {
    document.body.removeChild(el);
  }
}

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
  const addMemberByFriend = useAddMemberByFriend();
  const friendsQuery = useFriends();

  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);
  const [rotateArmed, setRotateArmed] = useState(false);
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [friendSearch, setFriendSearch] = useState('');
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
    setFriendSearch('');
  }, [open]);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  // WI-042: friends not already active in this group — the only ones this
  // action may target (server also enforces the friendship, defense in depth).
  const activeMemberIds = useMemo(
    () => new Set(group.members.map((m) => m.user.id)),
    [group.members],
  );
  const addableFriends = (friendsQuery.data ?? []).filter(
    (f) => !activeMemberIds.has(f.user.id),
  );

  // WI-048: client-side, case-insensitive substring filter — mirrors mobile's
  // `filterBySearch` (apps/mobile/src/lib/searchFilter.ts) byte-for-byte:
  // `.trim().toLowerCase().includes(...)`, no accent/diacritic folding, no
  // relevance re-sort. Display-only; the add-friend mutation below is
  // untouched.
  const friendSearchQuery = friendSearch.trim().toLowerCase();
  const filteredAddableFriends = friendSearchQuery
    ? addableFriends.filter((f) => f.user.name.toLowerCase().includes(friendSearchQuery))
    : addableFriends;

  const handleAddFriend = (userId: string, name: string) => {
    addMemberByFriend.mutate(
      { groupId: group.id, userId },
      {
        onSuccess: () => {
          toast.success(`Added ${name} to ${group.name}`);
        },
      },
    );
  };

  const inviteLink = origin ? `${origin}/join/${group.inviteCode}` : `/join/${group.inviteCode}`;
  const emailValid = EMAIL_PATTERN.test(email.trim());
  const emailError =
    emailTouched && email.trim().length > 0 && !emailValid
      ? 'Enter a valid email address'
      : null;

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteLink);
      } else {
        // navigator.clipboard undefined — non-secure context / embedded webview /
        // iframe without clipboard-write permission. Fallback: hidden textarea +
        // legacy execCommand. Throws if this also fails, caught below.
        copyViaFallback(inviteLink);
      }
      setCopied(true);
      toast.success('Invite link copied');
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[invite-dialog] copy failed', err);
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
          <span className="block text-[13px] font-medium text-ink-2">Invite code</span>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 px-4 py-3">
            <span className="font-mono text-lg font-semibold tabular-nums tracking-[0.15em] text-ink">
              {group.inviteCode}
            </span>
            <Button variant="secondary" onClick={() => void handleCopy()} aria-label="Copy invite link">
              {copied ? (
                <Check className="h-4 w-4 text-pos" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <Input
            value={inviteLink}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-[12px] tabular-nums"
            aria-label="Invite link"
          />
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

        <div className="h-px bg-hairline" role="separator" />

        <div className="space-y-1.5">
          <span className="block text-[13px] font-medium text-ink-2">Add from your friends</span>
          <Input
            type="search"
            value={friendSearch}
            onChange={(e) => setFriendSearch(e.target.value)}
            placeholder="Search friends"
            aria-label="Search friends"
            className="text-[13px]"
          />
          {addableFriends.length === 0 ? (
            <p className="text-[13px] text-ink-3">
              {friendsQuery.isLoading
                ? 'Loading your friends…'
                : 'All your friends are already in this group.'}
            </p>
          ) : filteredAddableFriends.length === 0 ? (
            <p className="text-[13px] text-ink-3">No friends match your search.</p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {filteredAddableFriends.map((f) => (
                <li
                  key={f.user.id}
                  className="flex items-center justify-between gap-2 rounded-lg px-1 py-1.5 hover:bg-surface-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar user={f.user} size="sm" />
                    <span className="truncate text-sm text-ink">{f.user.name}</span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    aria-label={`Add ${f.user.name}`}
                    loading={addMemberByFriend.isPending}
                    onClick={() => handleAddFriend(f.user.id, f.user.name)}
                  >
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogBody>
    </Dialog>
  );
}
