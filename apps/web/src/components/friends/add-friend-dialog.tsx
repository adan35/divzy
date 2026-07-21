'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Mail, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '@divzy/api-client';
import { zAddFriendInput, zEmail, zPhone } from '@divzy/shared';
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

/**
 * Add a friend by their Divzy account email or phone number. A 404 gets a
 * friendly inline explanation (they simply don't have an account yet).
 */
export function AddFriendDialog({ open, onOpenChange }: AddFriendDialogProps) {
  const addFriend = useAddFriend();
  const [identifier, setIdentifier] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setIdentifier('');
    setTouched(false);
    addFriend.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open
  }, [open]);

  const trimmed = identifier.trim();
  const identifierValid =
    zEmail.safeParse(trimmed).success || zPhone.safeParse(trimmed).success;
  const identifierError =
    touched && !identifierValid ? 'Enter a valid email or phone number' : null;
  const notFound = addFriend.error instanceof ApiError && addFriend.error.isNotFound;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    const parsed = zAddFriendInput.safeParse({ identifier: trimmed });
    if (!parsed.success || addFriend.isPending) return;
    addFriend.mutate(parsed.data, {
      onSuccess: (friend) => {
        toast.success(`👥 ${friend.user.name} is now your friend`);
        onOpenChange(false);
      },
    });
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
            Enter the email or phone number they use on Divzy — you can start splitting right
            away.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3 pb-2">
          <Field label="Email or phone" error={identifierError} required>
            {(id) => (
              <Input
                id={id}
                type="text"
                autoComplete="off"
                placeholder="you@example.com or +1 415 555 2671"
                value={identifier}
                invalid={identifierError !== null}
                disabled={addFriend.isPending}
                data-autofocus
                onChange={(e) => {
                  setIdentifier(e.target.value);
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
                No Divzy account for that email or phone yet — invite them to sign up, then
                add them here. Divzy is free for everyone.
              </p>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={addFriend.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={addFriend.isPending} disabled={!identifierValid}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Add friend
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
