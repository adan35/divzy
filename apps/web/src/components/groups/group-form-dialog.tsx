'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  GROUP_TYPES,
  LIMITS,
  type GroupDto,
  type GroupType,
} from '@divzy/shared';
import { useCreateGroup, useUpdateGroup } from '@/lib/hooks';
import { useAuth } from '@/lib/auth-store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { CurrencySelect } from '@/components/ui/currency-select';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

/** Curated 24-emoji grid — includes every group-type emoji so auto-sync always highlights. */
const EMOJI_CHOICES = [
  '✈️', '🏠', '❤️', '👥', '💼', '📋', '🍕', '🛒',
  '🚗', '🏖️', '⛷️', '🎉', '🍻', '☕', '🎮', '⚽',
  '🐾', '🎓', '🎵', '🛍️', '🧳', '🌮', '🏋️', '🎬',
] as const;

function typeEmoji(type: GroupType): string {
  return GROUP_TYPES.find((t) => t.key === type)?.emoji ?? '📋';
}

export interface GroupFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When present, the dialog edits this group instead of creating one. */
  group?: GroupDto;
}

interface ToggleProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

function Toggle({ id, checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-10 shrink-0 rounded-full transition-colors',
        checked ? 'bg-brand' : 'bg-surface-2 ring-1 ring-inset ring-hairline',
        disabled && 'cursor-not-allowed opacity-55',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
          checked && 'translate-x-4',
        )}
      />
    </button>
  );
}

/**
 * Create / edit a group: name, emoji (curated grid), type, currency,
 * simplify-debts toggle. On create the user is taken straight to the group.
 */
export function GroupFormDialog({ open, onOpenChange, group }: GroupFormDialogProps) {
  const isEdit = group !== undefined;
  const router = useRouter();
  const { user } = useAuth();
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const saving = createGroup.isPending || updateGroup.isPending;

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string>('✈️');
  const [type, setType] = useState<GroupType>('TRIP');
  const [currency, setCurrency] = useState('USD');
  const [simplifyDebts, setSimplifyDebts] = useState(true);
  const [nameTouched, setNameTouched] = useState(false);
  const emojiTouched = useRef(false);

  // (Re)initialize whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    if (group) {
      setName(group.name);
      setEmoji(group.emoji);
      setType(group.type);
      setCurrency(group.currency);
      setSimplifyDebts(group.simplifyDebts);
      emojiTouched.current = true; // never clobber an existing emoji on type change
    } else {
      setName('');
      setEmoji(typeEmoji('TRIP'));
      setType('TRIP');
      setCurrency(user?.defaultCurrency ?? 'USD');
      setSimplifyDebts(true);
      emojiTouched.current = false;
    }
    setNameTouched(false);
  }, [open, group, user?.defaultCurrency]);

  const nameValid = name.trim().length > 0;
  const nameError = nameTouched && !nameValid ? 'Give your group a name' : null;

  const handleTypeChange = (next: GroupType) => {
    setType(next);
    // Keep emoji in sync with the type until the user picks one themselves.
    if (!emojiTouched.current) setEmoji(typeEmoji(next));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!nameValid || saving) {
      setNameTouched(true);
      return;
    }
    const input = {
      name: name.trim(),
      emoji,
      type,
      currency,
      simplifyDebts,
    };
    if (isEdit && group) {
      updateGroup.mutate(
        { groupId: group.id, input },
        {
          onSuccess: () => {
            toast.success('Group updated');
            onOpenChange(false);
          },
        },
      );
    } else {
      createGroup.mutate(input, {
        onSuccess: (created) => {
          toast.success(`${created.emoji} ${created.name} is ready`, {
            description: 'Invite people, then add your first expense.',
          });
          onOpenChange(false);
          router.push(`/groups/${created.id}`);
        },
      });
    }
  };

  // Show a stale/custom emoji in the grid even if it is not part of the curated set.
  const gridEmojis: string[] = EMOJI_CHOICES.includes(emoji as (typeof EMOJI_CHOICES)[number])
    ? [...EMOJI_CHOICES]
    : [emoji, ...EMOJI_CHOICES.slice(0, EMOJI_CHOICES.length - 1)];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      ariaLabel={isEdit ? 'Edit group' : 'New group'}
      dismissible={!saving}
    >
      <form onSubmit={handleSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit group' : 'New group'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update the details — every member sees the change.'
              : 'A shared space for expenses with your crew.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4 pb-4">
          <Field label="Name" error={nameError} required>
            {(id) => (
              <Input
                id={id}
                value={name}
                autoFocus
                maxLength={LIMITS.GROUP_NAME_MAX}
                placeholder="Lisbon trip, Apartment 4B…"
                invalid={nameError !== null}
                disabled={saving}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setNameTouched(true)}
              />
            )}
          </Field>

          <div className="space-y-1.5">
            <span className="block text-[13px] font-medium text-ink-2">Emoji</span>
            <div role="radiogroup" aria-label="Group emoji" className="grid grid-cols-8 gap-1">
              {gridEmojis.map((choice) => {
                const selected = choice === emoji;
                return (
                  <button
                    key={choice}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`Emoji ${choice}`}
                    disabled={saving}
                    onClick={() => {
                      emojiTouched.current = true;
                      setEmoji(choice);
                    }}
                    className={cn(
                      'flex h-9 items-center justify-center rounded-lg text-lg transition-colors',
                      selected
                        ? 'bg-brand-soft ring-2 ring-brand'
                        : 'hover:bg-surface-2',
                      saving && 'cursor-not-allowed opacity-55',
                    )}
                  >
                    {choice}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Type">
              {(id) => (
                <Select
                  id={id}
                  value={type}
                  disabled={saving}
                  onChange={(e) => handleTypeChange(e.target.value as GroupType)}
                >
                  {GROUP_TYPES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.emoji} {t.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="Currency"
              hint={isEdit ? undefined : 'Default for new expenses in this group.'}
            >
              {(id) => (
                <CurrencySelect id={id} value={currency} onChange={setCurrency} disabled={saving} />
              )}
            </Field>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl border border-hairline bg-surface p-4">
            <div className="min-w-0">
              <label htmlFor="group-simplify" className="block text-sm font-medium text-ink">
                Simplify debts
              </label>
              <p className="mt-0.5 text-[13px] text-ink-3">
                Combine IOUs into the fewest possible payments.
              </p>
            </div>
            <Toggle
              id="group-simplify"
              checked={simplifyDebts}
              onChange={setSimplifyDebts}
              disabled={saving}
            />
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={!nameValid}>
            {isEdit ? 'Save changes' : 'Create group'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
