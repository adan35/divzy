'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Check, ChevronDown, FileText, Paperclip, StickyNote, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  EXPENSE_CATEGORIES,
  LIMITS,
  type CreateExpenseInput,
  type ExpenseCategory,
  type ExpenseDto,
  type FriendDto,
  type GroupSummaryDto,
  type PublicUserDto,
  type UpdateExpenseInput,
} from '@divzy/shared';
import { apiUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import {
  errorMessage,
  useCreateExpense,
  useFriends,
  useGroup,
  useGroups,
  useUpdateExpense,
  useUploadReceipt,
  useUsedCategories,
} from '@/lib/hooks';
import { AmountInput } from '@/components/ui/amount-input';
import { Button } from '@/components/ui/button';
import { CurrencySelect } from '@/components/ui/currency-select';
import { DateInput } from '@/components/ui/date-input';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { SearchSelect } from '@/components/ui/search-select';
import { SegmentedControl } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  buildPayers,
  createDefaultPayerState,
  PayerSelector,
  payerStateFromExpense,
  type PayerState,
} from './payer-selector';
import {
  createDefaultSplitState,
  evaluateSplit,
  SplitEditor,
  splitStateFromExpense,
  type SplitState,
} from './split-editor';

export interface ExpenseEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preselect this group in the editor. */
  groupId?: string;
  /** Preselect a non-group expense shared with this friend. */
  friendUserId?: string;
  /** When present, the dialog edits this expense instead of creating one. */
  expense?: ExpenseDto;
  onSaved?: (expense: ExpenseDto) => void;
}

/**
 * The expense editor — create + edit, all 6 split types, multi-payer,
 * itemized rows, receipt upload. Context: a group, a friend, or a picker.
 */
export function ExpenseEditorDialog({
  open,
  onOpenChange,
  groupId,
  friendUserId,
  expense,
  onSaved,
}: ExpenseEditorDialogProps) {
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) setSaving(false);
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Never close mid-save — the success/invalidations must land first.
        if (!saving) onOpenChange(next);
      }}
      size="lg"
      ariaLabel={expense ? 'Edit expense' : 'Add expense'}
      dismissible={!saving}
    >
      {/* The Dialog unmounts children on close, so the form resets each open. */}
      <ExpenseEditorForm
        groupId={groupId}
        friendUserId={friendUserId}
        expense={expense}
        onSaved={onSaved}
        onOpenChange={onOpenChange}
        onSavingChange={setSaving}
      />
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

interface ExpenseEditorFormProps {
  groupId?: string;
  friendUserId?: string;
  expense?: ExpenseDto;
  onSaved?: (expense: ExpenseDto) => void;
  onOpenChange: (open: boolean) => void;
  onSavingChange: (saving: boolean) => void;
}

function ExpenseEditorForm({
  groupId,
  friendUserId,
  expense,
  onSaved,
  onOpenChange,
  onSavingChange,
}: ExpenseEditorFormProps) {
  const { user: me } = useAuth();
  const isEdit = !!expense;

  // -- Context resolution ---------------------------------------------------

  const needsPicker = !isEdit && !groupId && !friendUserId;
  const [pickerMode, setPickerMode] = useState<'group' | 'friend'>('group');
  const [pickedGroupId, setPickedGroupId] = useState('');
  const [pickedFriendId, setPickedFriendId] = useState('');

  const ctxGroupId = isEdit
    ? expense?.groupId ?? undefined
    : groupId ?? (needsPicker && pickerMode === 'group' && pickedGroupId ? pickedGroupId : undefined);
  const ctxFriendId = isEdit
    ? undefined
    : friendUserId ??
      (needsPicker && pickerMode === 'friend' && pickedFriendId ? pickedFriendId : undefined);

  const groupsQuery = useGroups();
  const friendsQuery = useFriends();
  const groupQuery = useGroup(ctxGroupId ?? '', !!ctxGroupId);

  const loadedGroup = ctxGroupId && groupQuery.data?.id === ctxGroupId ? groupQuery.data : undefined;
  const friendUser = ctxFriendId
    ? friendsQuery.data?.find((f) => f.user.id === ctxFriendId)?.user
    : undefined;

  const members = useMemo<PublicUserDto[]>(() => {
    const map = new Map<string, PublicUserDto>();
    if (isEdit && expense) {
      // Everyone on the expense (payers ∪ splits) plus current group members.
      for (const p of expense.payers) map.set(p.user.id, p.user);
      for (const s of expense.splits) map.set(s.user.id, s.user);
      if (loadedGroup) for (const m of loadedGroup.members) map.set(m.user.id, m.user);
      return [...map.values()];
    }
    if (ctxGroupId) {
      if (loadedGroup) for (const m of loadedGroup.members) map.set(m.user.id, m.user);
      return [...map.values()];
    }
    if (ctxFriendId && me && friendUser) {
      map.set(me.id, { id: me.id, name: me.name, avatarColor: me.avatarColor });
      map.set(friendUser.id, friendUser);
      return [...map.values()];
    }
    return [];
  }, [isEdit, expense, ctxGroupId, ctxFriendId, loadedGroup, friendUser, me]);

  // -- Field state ------------------------------------------------------------

  const [description, setDescription] = useState(expense?.description ?? '');
  const [amount, setAmount] = useState<number | null>(expense?.amount ?? null);
  const [currency, setCurrency] = useState(expense?.currency ?? me?.defaultCurrency ?? 'USD');
  const currencyTouched = useRef(isEdit);
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? 'GENERAL');
  // WI-032: narrow the category picker to categories this group actually
  // uses, plus the current form value (D4/D5/D6/D7 — see spec-WI-032 §3).
  const [showAllCategories, setShowAllCategories] = useState(false);
  const usedCategoriesQuery = useUsedCategories({ groupId: ctxGroupId });
  const usedCategorySet = useMemo(
    () => new Set(usedCategoriesQuery.data?.categories ?? []),
    [usedCategoriesQuery.data],
  );
  const narrowedCategories = useMemo(
    () => EXPENSE_CATEGORIES.filter((c) => usedCategorySet.has(c.key) || c.key === category),
    [usedCategorySet, category],
  );
  const showAllCategoryOptions =
    !ctxGroupId ||
    showAllCategories ||
    usedCategoriesQuery.isLoading ||
    usedCategoriesQuery.isError ||
    usedCategorySet.size === 0;
  const categoryOptions = showAllCategoryOptions ? EXPENSE_CATEGORIES : narrowedCategories;
  const [date, setDate] = useState(expense?.date ?? new Date().toISOString());
  const [notes, setNotes] = useState(expense?.notes ?? '');
  const [notesOpen, setNotesOpen] = useState(!!expense?.notes);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(expense?.receiptUrl ?? null);
  const [splitState, setSplitState] = useState<SplitState | null>(() =>
    expense ? splitStateFromExpense(expense) : null,
  );
  const [payerState, setPayerState] = useState<PayerState | null>(() =>
    expense && me ? payerStateFromExpense(expense, me.id) : null,
  );

  // (Re)initialize payers + split whenever the member set resolves/changes in
  // create mode; in edit mode only fill gaps, never clobber in-progress edits.
  const membersKey = members
    .map((m) => m.id)
    .sort()
    .join(',');
  const initKey = useRef<string | null>(null);
  useEffect(() => {
    if (!me || members.length === 0) return;
    if (isEdit && expense) {
      setSplitState((prev) => prev ?? splitStateFromExpense(expense));
      setPayerState((prev) => prev ?? payerStateFromExpense(expense, me.id));
      return;
    }
    if (initKey.current === membersKey) return;
    initKey.current = membersKey;
    setSplitState(createDefaultSplitState(members.map((m) => m.id)));
    setPayerState(createDefaultPayerState(me.id));
  }, [membersKey, me, isEdit, expense, members]);

  // Default currency follows the context (group currency, else my default)
  // until the user picks one explicitly.
  const contextCurrency = ctxGroupId ? loadedGroup?.currency : me?.defaultCurrency;
  useEffect(() => {
    if (currencyTouched.current || !contextCurrency) return;
    setCurrency(contextCurrency);
  }, [contextCurrency]);

  // -- Derived validation ------------------------------------------------------

  const evaluation = useMemo(
    () => (splitState ? evaluateSplit(splitState, amount) : null),
    [splitState, amount],
  );
  const payersPayload = useMemo(
    () => (payerState ? buildPayers(payerState, amount) : null),
    [payerState, amount],
  );

  const involvementError = useMemo(() => {
    if (ctxGroupId || !me || !payersPayload || !evaluation?.computed) return null;
    const ids = new Set<string>();
    for (const p of payersPayload) ids.add(p.userId);
    for (const p of evaluation.participants) ids.add(p.userId);
    if (!ids.has(me.id)) return 'You must be part of a non-group expense, as a payer or participant.';
    if (ids.size < 2) return 'Share this expense with at least one other person.';
    return null;
  }, [ctxGroupId, me, payersPayload, evaluation]);

  const upload = useUploadReceipt();
  const createMutation = useCreateExpense();
  const updateMutation = useUpdateExpense();
  const pending = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    onSavingChange(pending);
  }, [pending, onSavingChange]);

  const contextChosen = isEdit || !!ctxGroupId || !!ctxFriendId;
  const ready = members.length > 0 && !!splitState && !!payerState;
  const canSave =
    ready &&
    contextChosen &&
    description.trim().length > 0 &&
    amount !== null &&
    amount > 0 &&
    !!evaluation?.computed &&
    !!payersPayload &&
    !involvementError &&
    !upload.isPending &&
    !pending;

  // -- Submit -------------------------------------------------------------------

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSave || !splitState || !evaluation?.computed || !payersPayload || amount === null) {
      return;
    }
    const core: UpdateExpenseInput = {
      description: description.trim(),
      amount,
      currency,
      category,
      date,
      splitType: splitState.splitType,
      payers: payersPayload,
      participants: evaluation.participants,
    };
    if (splitState.splitType === 'ITEMIZED' && evaluation.items) core.items = evaluation.items;
    const trimmedNotes = notes.trim();
    if (trimmedNotes) core.notes = trimmedNotes;
    if (receiptUrl) core.receiptUrl = receiptUrl;

    if (isEdit && expense) {
      updateMutation.mutate(
        { expenseId: expense.id, input: core },
        {
          onSuccess: (dto) => {
            toast.success(`✅ ${dto.description} updated`);
            onSaved?.(dto);
            onOpenChange(false);
          },
        },
      );
    } else {
      const input: CreateExpenseInput = { ...core, groupId: ctxGroupId ?? null };
      createMutation.mutate(input, {
        onSuccess: (dto) => {
          toast.success(`✅ ${dto.description} added`);
          onSaved?.(dto);
          onOpenChange(false);
        },
      });
    }
  };

  // -- Bits of UI ------------------------------------------------------------------

  const contextLabel = isEdit
    ? expense?.group
      ? `${expense.group.emoji} ${expense.group.name}`
      : 'Shared outside a group'
    : loadedGroup
      ? `${loadedGroup.emoji} ${loadedGroup.name}`
      : friendUser
        ? `With ${friendUser.name}`
        : null;

  const activeGroups = (groupsQuery.data ?? []).filter((g) => g.archivedAt === null);
  const friends = friendsQuery.data ?? [];

  const contextError = ctxGroupId
    ? groupQuery.error
    : ctxFriendId
      ? friendsQuery.error ??
        (friendsQuery.isSuccess && !friendUser ? new Error('This friend could not be found.') : null)
      : null;

  const receiptIsPdf = receiptUrl !== null && /\.pdf(\?.*)?$/i.test(receiptUrl);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <form onSubmit={handleSubmit} noValidate>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit expense' : 'Add expense'}</DialogTitle>
        {contextLabel && <DialogDescription>{contextLabel}</DialogDescription>}
      </DialogHeader>

      <DialogBody className="space-y-4 pb-2">
        {needsPicker && (
          <div className="space-y-2 rounded-xl border border-hairline bg-surface-2 p-3">
            <SegmentedControl
              aria-label="Share this expense with"
              options={[
                { value: 'group', label: 'Group' },
                { value: 'friend', label: 'Friend' },
              ]}
              value={pickerMode}
              onChange={setPickerMode}
            />
            {pickerMode === 'group' ? (
              groupsQuery.isLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : activeGroups.length === 0 ? (
                <p className="text-[13px] text-ink-3">
                  You&rsquo;re not in any groups yet — create one from the Groups page, or split
                  with a friend instead.
                </p>
              ) : (
                <SearchSelect<GroupSummaryDto>
                  key="group"
                  items={activeGroups}
                  value={pickedGroupId || null}
                  onChange={setPickedGroupId}
                  getKey={(g) => g.id}
                  getSearchText={(g) => g.name}
                  searchPlaceholder="Search groups…"
                  searchAriaLabel="Search groups"
                  emptyLabel="No groups found"
                  listAriaLabel="Choose a group"
                  renderTrigger={(selected) => (
                    <>
                      <span className="flex min-w-0 items-center gap-2">
                        {selected ? (
                          <>
                            <span aria-hidden="true">{selected.emoji}</span>
                            <span className="truncate font-medium">{selected.name}</span>
                          </>
                        ) : (
                          <span className="text-ink-3">Choose a group…</span>
                        )}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
                    </>
                  )}
                  renderRow={(g, { selected }) => (
                    <>
                      <span aria-hidden="true">{g.emoji}</span>
                      <span className="min-w-0 flex-1 truncate">{g.name}</span>
                      {selected && <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />}
                    </>
                  )}
                />
              )
            ) : friendsQuery.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : friends.length === 0 ? (
              <p className="text-[13px] text-ink-3">
                You haven&rsquo;t added any friends yet — add one from the Friends page.
              </p>
            ) : (
              <SearchSelect<FriendDto>
                key="friend"
                items={friends}
                value={pickedFriendId || null}
                onChange={setPickedFriendId}
                getKey={(f) => f.user.id}
                getSearchText={(f) => f.user.name}
                searchPlaceholder="Search friends…"
                searchAriaLabel="Search friends"
                emptyLabel="No friends found"
                listAriaLabel="Choose a friend"
                renderTrigger={(selected) => (
                  <>
                    <span className="flex min-w-0 items-center gap-2">
                      {selected ? (
                        <span className="truncate font-medium">{selected.user.name}</span>
                      ) : (
                        <span className="text-ink-3">Choose a friend…</span>
                      )}
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
                  </>
                )}
                renderRow={(f, { selected }) => (
                  <>
                    <span className="min-w-0 flex-1 truncate">{f.user.name}</span>
                    {selected && <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />}
                  </>
                )}
              />
            )}
          </div>
        )}

        <Field label="Description" required>
          {(id) => (
            <Input
              id={id}
              data-autofocus
              value={description}
              maxLength={LIMITS.DESCRIPTION_MAX}
              placeholder="Dinner, taxi, groceries…"
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>

        <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-3">
          <Field label="Amount" required>
            {(id) => (
              <AmountInput id={id} value={amount} onChange={setAmount} currency={currency} />
            )}
          </Field>
          <Field label="Currency">
            {(id) => (
              <CurrencySelect
                id={id}
                value={currency}
                onChange={(code) => {
                  currencyTouched.current = true;
                  setCurrency(code);
                }}
              />
            )}
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date">
            {(id) => <DateInput id={id} value={date} onChange={setDate} />}
          </Field>
          <Field label="Category">
            {(id) => (
              <div className="space-y-1">
                <Select
                  id={id}
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                >
                  {categoryOptions.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.emoji} {c.label}
                    </option>
                  ))}
                </Select>
                {!showAllCategoryOptions && (
                  <button
                    type="button"
                    onClick={() => setShowAllCategories(true)}
                    className="text-[13px] font-medium text-brand transition-colors hover:text-brand-hover"
                  >
                    More categories
                  </button>
                )}
              </div>
            )}
          </Field>
        </div>

        {!contextChosen ? (
          <p className="rounded-xl border border-dashed border-hairline px-4 py-6 text-center text-sm text-ink-3">
            Choose a group or friend above to set who paid and how to split.
          </p>
        ) : contextError ? (
          <p className="rounded-xl border border-hairline bg-neg-soft px-4 py-3 text-sm text-neg" role="alert">
            {errorMessage(contextError)}
          </p>
        ) : !ready || !splitState || !payerState || !me ? (
          <div className="space-y-3" aria-hidden="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <span className="block text-[13px] font-medium text-ink-2">Paid by</span>
              <PayerSelector
                members={members}
                meId={me.id}
                amount={amount}
                currency={currency}
                value={payerState}
                onChange={setPayerState}
              />
            </div>

            <div className="space-y-1.5">
              <span className="block text-[13px] font-medium text-ink-2">Split</span>
              <SplitEditor
                members={members}
                meId={me.id}
                amount={amount}
                currency={currency}
                value={splitState}
                onChange={setSplitState}
              />
            </div>

            {involvementError && (
              <p className="text-[13px] font-medium text-danger" role="alert">
                {involvementError}
              </p>
            )}
          </>
        )}

        {notesOpen && (
          <Field label="Notes">
            {(id) => (
              <Textarea
                id={id}
                value={notes}
                maxLength={LIMITS.NOTES_MAX}
                placeholder="Anything worth remembering…"
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
          </Field>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {!notesOpen && (
            <Button variant="outline" size="sm" onClick={() => setNotesOpen(true)}>
              <StickyNote className="h-3.5 w-3.5" aria-hidden="true" />
              Add notes
            </Button>
          )}
          {receiptUrl ? (
            <span className="inline-flex items-center gap-2 rounded-xl border border-hairline p-1.5 pr-2">
              {receiptIsPdf ? (
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={apiUrl(receiptUrl)}
                  alt="Receipt"
                  className="h-9 w-9 rounded-lg border border-hairline object-cover"
                />
              )}
              <a
                href={apiUrl(receiptUrl)}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] font-medium text-brand hover:underline"
              >
                Receipt attached
              </a>
              <button
                type="button"
                aria-label="Remove receipt"
                onClick={() => setReceiptUrl(null)}
                className="rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              loading={upload.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
              Attach receipt
            </Button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            aria-label="Upload receipt"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              upload.mutate(file, { onSuccess: (res) => setReceiptUrl(res.url) });
            }}
          />
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending} disabled={!canSave}>
          {isEdit ? 'Save changes' : 'Save expense'}
        </Button>
      </DialogFooter>
    </form>
  );
}
