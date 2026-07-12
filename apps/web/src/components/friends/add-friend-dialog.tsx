'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Mail, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '@divzy/api-client';
import { useAddFriend } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';

export interface AddFriendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Add a friend by their Divzy account email. A 404 gets a friendly inline
 * explanation (they simply don't have an account yet).
 */
export function AddFriendDialog({ open, onOpenChange }: AddFriendDialogProps) {
  const addFriend = useAddFriend();
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmail('');
    setTouched(false);
    addFriend.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open
  }, [open]);

  const trimmed = email.trim();
  const emailValid = EMAIL_PATTERN.test(trimmed);
  const emailError = touched && !emailValid ? 'Enter a valid email address' : null;
  const notFound = addFriend.error instanceof ApiError && addFriend.error.isNotFound;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!emailValid || addFriend.isPending) return;
    addFriend.mutate(
      { email: trimmed.toLowerCase() },
      {
        onSuccess: (friend) => {
          toast.success(`👥 ${friend.user.name} is now your friend`);
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      ariaLabel="Add a friend"
      dismissible={!addFriend.isPending}
    >
      <form onSubmit={handleSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>Add a friend</DialogTitle>
          <DialogDescription>
            Enter the email they use on Divzy — you can start splitting right away.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3 pb-2">
          <Field label="Email" error={emailError} required>
            {(id) => (
              <Input
                id={id}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="friend@example.com"
                value={email}
                invalid={emailError !== null}
                disabled={addFriend.isPending}
                data-autofocus
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (addFriend.error) addFriend.reset();
                }}
                onBlur={() => setTouched(true)}
              />
            )}
          </Field>

          {notFound && (
            <div className="flex items-start gap-2.5 rounded-xl bg-surface-2 px-3.5 py-3">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
              <p className="text-[13px] leading-snug text-ink-2">
                No Divzy account for that email yet — invite them to sign up, then add them
                here. Divzy is free for everyone.
              </p>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={addFriend.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={addFriend.isPending} disabled={!emailValid}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Add friend
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
