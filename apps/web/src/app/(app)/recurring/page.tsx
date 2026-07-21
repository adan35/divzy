'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  EXPENSE_CATEGORIES,
  LIMITS,
  RECURRENCE_FREQUENCIES,
  categoryInfo,
  type CreateRecurringInput,
  type ExpenseCategory,
  type PublicUserDto,
  type RecurrenceFrequency,
  type RecurringExpenseDto,
} from '@divzy/shared';
import {
  errorMessage,
  useCreateRecurring,
  useDeleteRecurring,
  useFriends,
  useGroup,
  useGroups,
  useRecurring,
  useUpdateRecurring,
} from '@/lib/hooks';
import { useAuth } from '@/lib/auth-store';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AmountInput } from '@/components/ui/amount-input';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input } from '@/components/ui/input';
import { MoneyText } from '@/components/ui/money-text';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Skeleton, SkeletonList } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/groups/confirm-dialog';
import {
  SplitEditor,
  createDefaultSplitState,
  evaluateSplit,
  type SplitState,
} from '@/components/expenses/split-editor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function frequencyLabel(frequency: RecurrenceFrequency): string {
  return RECURRENCE_FREQUENCIES.find((f) => f.key === frequency)?.label ?? frequency;
}

function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors',
        checked ? 'bg-brand' : 'bg-hairline',
        disabled && 'cursor-not-allowed opacity-55',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
          checked && 'translate-x-5',
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// List card
// ---------------------------------------------------------------------------

function RecurringCard({
  recurring,
  onDelete,
}: {
  recurring: RecurringExpenseDto;
  onDelete: (recurring: RecurringExpenseDto) => void;
}) {
  const updateRecurring = useUpdateRecurring();
  const info = categoryInfo(recurring.category);

  return (
    <Card className={cn('flex items-center gap-3.5 p-4', !recurring.active && 'opacity-75')}>
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-xl"
        aria-hidden="true"
      >
        {info.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-ink">{recurring.description}</p>
          {!recurring.active && <Badge className="text-ink-3">Paused</Badge>}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-2">
          <MoneyText amount={recurring.amount} currency={recurring.currency} className="font-medium text-ink" />
          <Badge variant="brand">{frequencyLabel(recurring.frequency)}</Badge>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-3">
          {recurring.active ? (
            <span>Next on {formatDate(recurring.nextRunAt)}</span>
          ) : (
            <span>Paused</span>
          )}
          {recurring.endDate && <span>· until {formatDate(recurring.endDate)}</span>}
          {recurring.group && (
            <>
              <span aria-hidden="true">·</span>
              <Link
                href={`/groups/${recurring.group.id}`}
                className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink-2 transition-colors hover:bg-brand-soft hover:text-brand"
              >
                <span aria-hidden="true">{recurring.group.emoji}</span>
                <span className="max-w-[10rem] truncate">{recurring.group.name}</span>
              </Link>
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Switch
          label={`${recurring.active ? 'Pause' : 'Resume'} ${recurring.description}`}
          checked={recurring.active}
          disabled={updateRecurring.isPending}
          onChange={(next) =>
            updateRecurring.mutate(
              { recurringId: recurring.id, input: { active: next } },
              {
                onSuccess: () =>
                  toast.success(
                    next
                      ? `▶️ ${recurring.description} resumed`
                      : `⏸️ ${recurring.description} paused`,
                  ),
              },
            )
          }
        />
        <button
          type="button"
          aria-label={`Delete ${recurring.description}`}
          onClick={() => onDelete(recurring)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-neg-soft hover:text-danger"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// New recurring dialog — a mini expense editor (no ITEMIZED per schema).
// ---------------------------------------------------------------------------

const MULTI_PAYERS = '__multi__';

function NewRecurringDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user: me } = useAuth();
  const groupsQuery = useGroups();
  const friendsQuery = useFriends();
  const createRecurring = useCreateRecurring();

  const [context, setContext] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [category, setCategory] = useState<ExpenseCategory>('GENERAL');
  const [frequency, setFrequency] = useState<RecurrenceFrequency>('MONTHLY');
  const [startDate, setStartDate] = useState(() => new Date().toISOString());
  const [endDate, setEndDate] = useState('');
  const [payerSel, setPayerSel] = useState('');
  const [payerAmounts, setPayerAmounts] = useState<Record<string, number | null>>({});
  const [splitState, setSplitState] = useState<SplitState | null>(null);
  const [descTouched, setDescTouched] = useState(false);
  const [amountTouched, setAmountTouched] = useState(false);
  const currencyTouched = useRef(false);

  const groupId = context.startsWith('group:') ? context.slice('group:'.length) : '';
  const friendUserId = context.startsWith('friend:') ? context.slice('friend:'.length) : '';
  const groupQuery = useGroup(groupId, open && groupId !== '');
  const group = groupId ? groupQuery.data : undefined;
  const friend = friendUserId
    ? friendsQuery.data?.find((f) => f.user.id === friendUserId)
    : undefined;

  const members: PublicUserDto[] = useMemo(() => {
    if (groupId) return group?.members.map((m) => m.user) ?? [];
    if (friendUserId && me && friend) {
      return [
        { id: me.id, name: me.name, avatarColor: me.avatarColor, avatarUrl: me.avatarUrl },
        friend.user,
      ];
    }
    return [];
  }, [groupId, group, friendUserId, friend, me]);
  const membersKey = members.map((m) => m.id).join(',');

  // Full reset each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setContext('');
    setDescription('');
    setAmount(null);
    setCurrency(me?.defaultCurrency ?? 'USD');
    setCategory('GENERAL');
    setFrequency('MONTHLY');
    setStartDate(new Date().toISOString());
    setEndDate('');
    setPayerSel('');
    setPayerAmounts({});
    setSplitState(null);
    setDescTouched(false);
    setAmountTouched(false);
    currencyTouched.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open
  }, [open]);

  // Re-seed split + payers whenever the people involved change.
  useEffect(() => {
    if (!open) return;
    if (members.length === 0) {
      setSplitState(null);
      return;
    }
    const ids = members.map((m) => m.id);
    setSplitState(createDefaultSplitState(ids));
    setPayerAmounts({});
    setPayerSel(me && ids.includes(me.id) ? me.id : ids[0] ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by membership
  }, [open, membersKey]);

  // Adopt the group's currency once it loads (unless the user picked one).
  useEffect(() => {
    if (!open || currencyTouched.current) return;
    if (group?.currency) setCurrency(group.currency);
    else if (!groupId) setCurrency(me?.defaultCurrency ?? 'USD');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group?.currency, groupId]);

  const evaluation = splitState ? evaluateSplit(splitState, amount) : null;

  const contextChosen = groupId !== '' || friendUserId !== '';
  const membersLoading = groupId !== '' && groupQuery.isLoading;
  const descValid = description.trim().length > 0;
  const amountValid = amount !== null && amount > 0;
  const isItemized = splitState?.splitType === 'ITEMIZED';
  const splitOk = evaluation?.computed != null && !isItemized;

  const multiPayers = payerSel === MULTI_PAYERS;
  const payerSum = members.reduce((acc, m) => acc + (payerAmounts[m.id] ?? 0), 0);
  const payersOk = multiPayers
    ? amount !== null && payerSum === amount && members.some((m) => (payerAmounts[m.id] ?? 0) > 0)
    : payerSel !== '' && payerSel !== MULTI_PAYERS;

  const endDateInvalid =
    endDate !== '' && new Date(endDate).getTime() <= new Date(startDate).getTime();

  const valid =
    contextChosen &&
    members.length >= (groupId ? 1 : 2) &&
    descValid &&
    amountValid &&
    splitOk &&
    payersOk &&
    !endDateInvalid;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setDescTouched(true);
    setAmountTouched(true);
    if (!valid || !splitState || !evaluation || amount === null || createRecurring.isPending) {
      return;
    }

    const payers = multiPayers
      ? members
          .filter((m) => (payerAmounts[m.id] ?? 0) > 0)
          .map((m) => ({ userId: m.id, amount: payerAmounts[m.id] ?? 0 }))
      : [{ userId: payerSel, amount }];

    const input: CreateRecurringInput = {
      groupId: groupId || undefined,
      description: description.trim(),
      amount,
      currency,
      category,
      splitType: splitState.splitType,
      payers,
      participants: evaluation.participants,
      frequency,
      startDate,
      endDate: endDate || undefined,
    };

    createRecurring.mutate(input, {
      onSuccess: (created) => {
        toast.success('🔁 Recurring expense created', {
          description: `First run ${formatDate(created.nextRunAt)} — Divzy posts it automatically.`,
        });
        onOpenChange(false);
      },
    });
  };

  const descError = descTouched && !descValid ? 'Enter a description' : null;
  const amountError = amountTouched && !amountValid ? 'Enter an amount greater than zero' : null;
  const groups = (groupsQuery.data ?? []).filter((g) => g.archivedAt === null);
  const friends = friendsQuery.data ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      ariaLabel="New recurring expense"
      dismissible={!createRecurring.isPending}
    >
      <form onSubmit={handleSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>New recurring expense</DialogTitle>
          <DialogDescription>
            Divzy posts it automatically on schedule — same split every time.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4 pb-4">
          <Field label="Who is it with?" required>
            {(id) => (
              <Select
                id={id}
                value={context}
                disabled={createRecurring.isPending}
                onChange={(e) => setContext(e.target.value)}
              >
                <option value="" disabled>
                  Choose a group or friend…
                </option>
                {groups.length > 0 && (
                  <optgroup label="Groups">
                    {groups.map((g) => (
                      <option key={g.id} value={`group:${g.id}`}>
                        {g.emoji} {g.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {friends.length > 0 && (
                  <optgroup label="Friends">
                    {friends.map((f) => (
                      <option key={f.user.id} value={`friend:${f.user.id}`}>
                        {f.user.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Select>
            )}
          </Field>
          {groups.length === 0 && friends.length === 0 && !groupsQuery.isLoading && !friendsQuery.isLoading && (
            <p className="rounded-lg bg-surface-2 px-3 py-3 text-center text-[13px] text-ink-2">
              You need a group or a friend first — create one, then come back here.
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Description" error={descError} required>
              {(id) => (
                <Input
                  id={id}
                  value={description}
                  maxLength={LIMITS.DESCRIPTION_MAX}
                  placeholder="Rent, Netflix, internet…"
                  invalid={descError !== null}
                  disabled={createRecurring.isPending}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={() => setDescTouched(true)}
                />
              )}
            </Field>
            <Field label="Category">
              {(id) => (
                <Select
                  id={id}
                  value={category}
                  disabled={createRecurring.isPending}
                  onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.emoji} {c.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Amount" error={amountError} required>
              {(id) => (
                <AmountInput
                  id={id}
                  value={amount}
                  currency={currency}
                  invalid={amountError !== null}
                  disabled={createRecurring.isPending}
                  onChange={(v) => {
                    setAmount(v);
                    setAmountTouched(true);
                  }}
                />
              )}
            </Field>
            <Field label="Currency">
              {(id) => (
                <CurrencySelect
                  id={id}
                  value={currency}
                  disabled={createRecurring.isPending}
                  onChange={(code) => {
                    currencyTouched.current = true;
                    setCurrency(code);
                  }}
                />
              )}
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Repeats">
              {(id) => (
                <Select
                  id={id}
                  value={frequency}
                  disabled={createRecurring.isPending}
                  onChange={(e) => setFrequency(e.target.value as RecurrenceFrequency)}
                >
                  {RECURRENCE_FREQUENCIES.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="First run">
              {(id) => (
                <DateInput
                  id={id}
                  value={startDate}
                  disabled={createRecurring.isPending}
                  onChange={setStartDate}
                />
              )}
            </Field>
            <Field
              label="Ends"
              error={endDateInvalid ? 'Must be after the first run' : null}
              hint={endDate === '' ? 'Optional — runs forever.' : undefined}
            >
              {(id) => (
                <div className="flex items-center gap-1.5">
                  <DateInput
                    id={id}
                    value={endDate}
                    min={startDate}
                    invalid={endDateInvalid}
                    disabled={createRecurring.isPending}
                    onChange={setEndDate}
                  />
                  {endDate !== '' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 px-2"
                      disabled={createRecurring.isPending}
                      onClick={() => setEndDate('')}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              )}
            </Field>
          </div>

          {membersLoading ? (
            <div className="space-y-3 py-2" aria-hidden="true">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : members.length > 0 && me && splitState ? (
            <>
              <Field label="Paid by">
                {(id) => (
                  <Select
                    id={id}
                    value={payerSel}
                    disabled={createRecurring.isPending}
                    onChange={(e) => setPayerSel(e.target.value)}
                  >
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id === me.id ? 'You' : m.name}
                      </option>
                    ))}
                    <option value={MULTI_PAYERS}>Multiple people</option>
                  </Select>
                )}
              </Field>

              {multiPayers && (
                <div className="space-y-2 rounded-xl border border-hairline p-3">
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center gap-2.5">
                      <Avatar user={m} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">
                        {m.id === me.id ? 'You' : m.name}
                      </span>
                      <AmountInput
                        className="h-9 w-32"
                        currency={currency}
                        value={payerAmounts[m.id] ?? null}
                        disabled={createRecurring.isPending}
                        onChange={(v) => setPayerAmounts((prev) => ({ ...prev, [m.id]: v }))}
                        aria-label={`Amount paid by ${m.name}`}
                      />
                    </div>
                  ))}
                  {amount !== null && (
                    <p
                      className={cn(
                        'flex items-center justify-end gap-1 text-right text-[13px] font-medium',
                        payerSum === amount
                          ? 'text-pos'
                          : payerSum > amount
                            ? 'text-neg'
                            : 'text-warn',
                      )}
                    >
                      {payerSum === amount ? (
                        'Payments match the total ✓'
                      ) : payerSum > amount ? (
                        <>
                          <MoneyText amount={payerSum - amount} currency={currency} />
                          over the total
                        </>
                      ) : (
                        <>
                          <MoneyText amount={amount - payerSum} currency={currency} />
                          left to assign
                        </>
                      )}
                    </p>
                  )}
                </div>
              )}

              <div>
                <p className="mb-1.5 block text-[13px] font-medium text-ink-2">Split</p>
                <SplitEditor
                  members={members}
                  meId={me.id}
                  amount={amount}
                  currency={currency}
                  value={splitState}
                  onChange={setSplitState}
                />
                {isItemized && (
                  <p className="mt-2 text-[13px] font-medium text-warn" role="alert">
                    Recurring expenses can&rsquo;t use itemized splits — pick another split type.
                  </p>
                )}
              </div>
            </>
          ) : contextChosen && groupQuery.isError ? (
            <p className="rounded-lg bg-neg-soft px-3 py-3 text-center text-[13px] text-danger">
              {errorMessage(groupQuery.error)}
            </p>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={createRecurring.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" loading={createRecurring.isPending} disabled={!valid}>
            Create recurring
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RecurringPage() {
  const recurring = useRecurring();
  const deleteRecurring = useDeleteRecurring();
  const [newOpen, setNewOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RecurringExpenseDto | null>(null);

  const handleDelete = () => {
    if (!pendingDelete || deleteRecurring.isPending) return;
    deleteRecurring.mutate(pendingDelete.id, {
      onSuccess: () => {
        setPendingDelete(null);
        toast.success('Recurring expense deleted');
      },
    });
  };

  return (
    <>
      <PageHeader
        title="Recurring"
        subtitle="Expenses that post themselves, on schedule."
        actions={
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New recurring
          </Button>
        }
      />

      {recurring.isPending ? (
        <SkeletonList rows={3} avatar={false} />
      ) : recurring.isError ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="max-w-sm text-sm text-ink-2">{errorMessage(recurring.error)}</p>
          <Button variant="outline" size="sm" onClick={() => void recurring.refetch()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        </Card>
      ) : recurring.data.length === 0 ? (
        <EmptyState
          emoji="🔁"
          title="No recurring expenses yet"
          hint="Rent, utilities, subscriptions — set once, never forget."
          action={
            <Button onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New recurring
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {recurring.data.map((r) => (
            <RecurringCard key={r.id} recurring={r} onDelete={setPendingDelete} />
          ))}
        </div>
      )}

      <NewRecurringDialog open={newOpen} onOpenChange={setNewOpen} />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteRecurring.isPending) setPendingDelete(null);
        }}
        title={pendingDelete ? `Delete “${pendingDelete.description}”?` : 'Delete recurring?'}
        description="Future runs stop immediately. Expenses it already posted are kept."
        confirmLabel="Delete recurring"
        destructive
        loading={deleteRecurring.isPending}
        onConfirm={handleDelete}
      />
    </>
  );
}
