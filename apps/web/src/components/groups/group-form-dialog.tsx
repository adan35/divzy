'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  GROUP_EMOJI_CHOICES,
  GROUP_TYPES,
  LIMITS,
  SPLIT_TYPES,
  SPLIT_TYPE_LABELS,
  categoryInfo,
  groupTemplate,
  searchGroupEmoji,
  type ExpenseCategory,
  type GroupDto,
  type GroupType,
  type SplitType,
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
import { Toggle } from '@/components/ui/toggle';

function typeEmoji(type: GroupType): string {
  return GROUP_TYPES.find((t) => t.key === type)?.emoji ?? '📋';
}

function typeLabel(type: GroupType): string {
  return GROUP_TYPES.find((t) => t.key === type)?.label ?? type;
}

export interface GroupFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When present, the dialog edits this group instead of creating one. */
  group?: GroupDto;
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
  const [emojiQuery, setEmojiQuery] = useState('');
  const emojiTouched = useRef(false);

  // WI-020 — group-creation templates. Create-only, presentational, discarded
  // on submit: `categoryOptions` is the candidate chip list (frozen once
  // touched, refreshed on type change until then); `selectedCategories` is
  // the subset currently toggled on within that candidate list. Independent
  // `categoriesTouched`/`splitTypeTouched` flags mirror `emojiTouched` — an
  // override survives a later type switch instead of being clobbered.
  const [categoryOptions, setCategoryOptions] = useState<readonly ExpenseCategory[]>(
    () => groupTemplate('TRIP')?.categoryKeys ?? [],
  );
  const [selectedCategories, setSelectedCategories] = useState<readonly ExpenseCategory[]>(
    () => groupTemplate('TRIP')?.categoryKeys ?? [],
  );
  const [splitType, setSplitType] = useState<SplitType | undefined>(
    () => groupTemplate('TRIP')?.splitType,
  );
  const categoriesTouched = useRef(false);
  const splitTypeTouched = useRef(false);

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
      // Edit path never renders or uses the template block (spec-WI-020).
      setCategoryOptions([]);
      setSelectedCategories([]);
      setSplitType(undefined);
      categoriesTouched.current = true;
      splitTypeTouched.current = true;
    } else {
      setName('');
      setEmoji(typeEmoji('TRIP'));
      setType('TRIP');
      setCurrency(user?.defaultCurrency ?? 'USD');
      setSimplifyDebts(true);
      emojiTouched.current = false;
      const template = groupTemplate('TRIP');
      setCategoryOptions(template?.categoryKeys ?? []);
      setSelectedCategories(template?.categoryKeys ?? []);
      setSplitType(template?.splitType);
      categoriesTouched.current = false;
      splitTypeTouched.current = false;
    }
    setNameTouched(false);
    setEmojiQuery('');
  }, [open, group, user?.defaultCurrency]);

  const nameValid = name.trim().length > 0;
  const nameError = nameTouched && !nameValid ? 'Give your group a name' : null;

  const handleTypeChange = (next: GroupType) => {
    setType(next);
    // Keep emoji in sync with the type until the user picks one themselves.
    if (!emojiTouched.current) setEmoji(typeEmoji(next));
    // Same rule, per field, for the template suggestions (spec-WI-020 D4):
    // refresh an untouched field to the new type's template, or clear it if
    // the new type has none; leave an already-touched override intact.
    const nextTemplate = groupTemplate(next);
    if (!categoriesTouched.current) {
      setCategoryOptions(nextTemplate?.categoryKeys ?? []);
      setSelectedCategories(nextTemplate?.categoryKeys ?? []);
    }
    if (!splitTypeTouched.current) setSplitType(nextTemplate?.splitType);
  };

  const toggleCategory = (key: ExpenseCategory) => {
    categoriesTouched.current = true;
    setSelectedCategories((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const handleSplitTypeChange = (next: SplitType) => {
    splitTypeTouched.current = true;
    setSplitType(next);
  };

  const template = !isEdit ? groupTemplate(type) : undefined;

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
            router.replace('/groups');
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
          router.replace('/groups');
        },
      });
    }
  };

  // WI-031: the search-filtered set. A stale/custom emoji outside the curated
  // set (the existing `gridEmojis` fallback) stays visible/selected regardless
  // of the active query — it must never be lost behind a search that doesn't
  // happen to match it.
  const isCustomEmoji = !GROUP_EMOJI_CHOICES.includes(
    emoji as (typeof GROUP_EMOJI_CHOICES)[number],
  );
  const searchedEmojis = searchGroupEmoji(emojiQuery);
  const gridEmojis: string[] = isCustomEmoji ? [emoji, ...searchedEmojis] : [...searchedEmojis];

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
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3"
                aria-hidden="true"
              />
              <input
                type="search"
                role="searchbox"
                aria-label="Search emoji"
                value={emojiQuery}
                disabled={saving}
                placeholder="Search emoji…"
                onChange={(e) => setEmojiQuery(e.target.value)}
                className="mb-1.5 w-full rounded-lg border border-hairline-strong bg-surface py-1.5 pl-8 pr-2 text-[13px] text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-brand-soft"
              />
            </div>
            {gridEmojis.length === 0 ? (
              <p className="py-3 text-center text-[13px] text-ink-3">No matching emoji</p>
            ) : (
              <div
                role="radiogroup"
                aria-label="Group emoji"
                className="grid max-h-40 grid-cols-8 gap-1 overflow-y-auto"
              >
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
            )}
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

          {template && (
            <div className="space-y-3 rounded-xl border border-hairline bg-surface p-4">
              <p className="text-[13px] text-ink-3">
                Suggested for a {typeLabel(type)} group — you can change these
              </p>
              <div className="space-y-1.5">
                <span className="block text-[13px] font-medium text-ink-2">Categories</span>
                <div className="flex flex-wrap gap-1.5">
                  {categoryOptions.map((key) => {
                    const info = categoryInfo(key);
                    const selected = selectedCategories.includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={selected}
                        aria-label={info.label}
                        disabled={saving}
                        onClick={() => toggleCategory(key)}
                        className={cn(
                          'flex items-center gap-1 rounded-full border px-3 py-1 text-[13px] transition-colors',
                          selected
                            ? 'border-brand bg-brand-soft text-ink'
                            : 'border-hairline bg-surface-2 text-ink-3',
                          saving && 'cursor-not-allowed opacity-55',
                        )}
                      >
                        <span aria-hidden="true">{info.emoji}</span>
                        <span>{info.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <Field label="Suggested split mode">
                {(id) => (
                  <Select
                    id={id}
                    value={splitType ?? ''}
                    disabled={saving}
                    onChange={(e) => handleSplitTypeChange(e.target.value as SplitType)}
                  >
                    {SPLIT_TYPES.map((st) => (
                      <option key={st} value={st}>
                        {SPLIT_TYPE_LABELS[st]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          )}

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
