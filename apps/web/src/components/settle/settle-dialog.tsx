'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { toast } from 'sonner';
import {
  LIMITS,
  SETTLEMENT_METHODS,
  formatMoney,
  type PublicUserDto,
  type SettlementMethod,
} from '@divzy/shared';
import { useCreateSettlement, useFriends, useGroup } from '@/lib/hooks';
import { useAuth } from '@/lib/auth-store';
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
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

export interface SettleUpPrefill {
  fromUserId: string;
  toUserId: string;
  amount: number;
  currency: string;
}

export interface SettleUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Record the payment inside this group (parties = group members). */
  groupId?: string;
  /** One-tap prefill from a settlement suggestion. */
  prefill?: SettleUpPrefill;
}

/**
 * Record a payment between two people — from a suggestion (prefilled) or from
 * scratch. Parties come from the group's members, or from your friends list
 * for non-group payments. Validates: parties differ, you are involved, amount > 0.
 */
export function SettleUpDialog({ open, onOpenChange, groupId, prefill }: SettleUpDialogProps) {
  const { user: me } = useAuth();
  const groupQuery = useGroup(groupId ?? '', open && Boolean(groupId));
  const friendsQuery = useFriends();
  const createSettlement = useCreateSettlement();

  const [fromUserId, setFromUserId] = useState('');
  const [toUserId, setToUserId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [method, setMethod] = useState<SettlementMethod>('CASH');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString());
  const [amountTouched, setAmountTouched] = useState(false);
  const currencyTouched = useRef(false);

  const group = groupId ? groupQuery.data : undefined;

  const candidates: PublicUserDto[] = groupId
    ? group?.members.map((m) => m.user) ?? []
    : [
        ...(me ? [{ id: me.id, name: me.name, avatarColor: me.avatarColor }] : []),
        ...(friendsQuery.data?.map((f) => f.user) ?? []),
      ];

  // Reset the form each time the dialog opens (prefill wins over defaults).
  useEffect(() => {
    if (!open) return;
    setFromUserId(prefill?.fromUserId ?? me?.id ?? '');
    setToUserId(prefill?.toUserId ?? '');
    setAmount(prefill?.amount ?? null);
    setCurrency(prefill?.currency ?? group?.currency ?? me?.defaultCurrency ?? 'USD');
    setMethod('CASH');
    setNote('');
    setDate(new Date().toISOString());
    setAmountTouched(false);
    currencyTouched.current = Boolean(prefill?.currency);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open
  }, [open]);

  // Fill blanks once async data (group members / friends) arrives.
  useEffect(() => {
    if (!open || candidates.length === 0) return;
    if (!fromUserId && me) setFromUserId(me.id);
    if (!toUserId) {
      const firstOther = candidates.find((c) => c.id !== (fromUserId || me?.id));
      if (firstOther) setToUserId(firstOther.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reacts to data arrival
  }, [open, candidates.length, me?.id]);

  // Adopt the group currency when the group loads late (unless already chosen).
  useEffect(() => {
    if (!open || currencyTouched.current) return;
    if (group?.currency) setCurrency(group.currency);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group?.currency]);

  const loadingParties = groupId ? groupQuery.isLoading : friendsQuery.isLoading;
  const nameOf = (userId: string): string => {
    if (me && userId === me.id) return 'You';
    return candidates.find((c) => c.id === userId)?.name ?? 'Someone';
  };

  const partiesDiffer = fromUserId !== '' && toUserId !== '' && fromUserId !== toUserId;
  const meInvolved = me !== null && (fromUserId === me.id || toUserId === me.id);
  const amountValid = amount !== null && amount > 0;
  const partyError = !partiesDiffer
    ? fromUserId && toUserId
      ? 'Payer and recipient must differ'
      : null
    : !meInvolved
      ? 'You must be the payer or the recipient'
      : null;
  const amountError = amountTouched && !amountValid ? 'Enter an amount greater than zero' : null;
  const valid = partiesDiffer && meInvolved && amountValid;

  const handleSwap = () => {
    setFromUserId(toUserId);
    setToUserId(fromUserId);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setAmountTouched(true);
    if (!valid || amount === null || createSettlement.isPending) return;
    const paidAmount = amount;
    const paidCurrency = currency;
    const fromName = nameOf(fromUserId);
    const toName = nameOf(toUserId);
    createSettlement.mutate(
      {
        groupId: groupId ?? undefined,
        fromUserId,
        toUserId,
        amount: paidAmount,
        currency: paidCurrency,
        method,
        note: note.trim() === '' ? undefined : note.trim(),
        date,
      },
      {
        onSuccess: () => {
          toast.success('💸 Payment recorded', {
            description: `${fromName} paid ${toName} ${formatMoney(paidAmount, paidCurrency)}. Feels lighter already.`,
          });
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      ariaLabel="Record a payment"
      dismissible={!createSettlement.isPending}
    >
      <form onSubmit={handleSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>
            Log money that changed hands — balances update instantly.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4 pb-4">
          {loadingParties ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-2/3" />
            </div>
          ) : candidates.length < 2 ? (
            <p className="rounded-lg bg-surface-2 px-3 py-4 text-center text-sm text-ink-2">
              {groupId
                ? 'This group needs at least two members before you can record a payment.'
                : 'Add a friend or join a group first — then record payments here.'}
            </p>
          ) : (
            <>
              <div className="flex items-end gap-2">
                <Field label="From" className="min-w-0 flex-1">
                  {(id) => (
                    <Select
                      id={id}
                      value={fromUserId}
                      disabled={createSettlement.isPending}
                      onChange={(e) => setFromUserId(e.target.value)}
                    >
                      {candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {me && c.id === me.id ? ' (you)' : ''}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Button
                  variant="ghost"
                  size="md"
                  className="mb-0 shrink-0 px-2.5"
                  aria-label="Swap payer and recipient"
                  disabled={createSettlement.isPending}
                  onClick={handleSwap}
                >
                  <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Field label="To" className="min-w-0 flex-1">
                  {(id) => (
                    <Select
                      id={id}
                      value={toUserId}
                      disabled={createSettlement.isPending}
                      onChange={(e) => setToUserId(e.target.value)}
                    >
                      {candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {me && c.id === me.id ? ' (you)' : ''}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              {partyError && (
                <p className="text-[13px] text-danger" role="alert">
                  {partyError}
                </p>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Amount" error={amountError} required>
                  {(id) => (
                    <AmountInput
                      id={id}
                      value={amount}
                      currency={currency}
                      invalid={amountError !== null}
                      disabled={createSettlement.isPending}
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
                      disabled={createSettlement.isPending}
                      onChange={(code) => {
                        currencyTouched.current = true;
                        setCurrency(code);
                      }}
                    />
                  )}
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Method">
                  {(id) => (
                    <Select
                      id={id}
                      value={method}
                      disabled={createSettlement.isPending}
                      onChange={(e) => setMethod(e.target.value as SettlementMethod)}
                    >
                      {SETTLEMENT_METHODS.map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Date">
                  {(id) => (
                    <DateInput
                      id={id}
                      value={date}
                      max={new Date().toISOString()}
                      disabled={createSettlement.isPending}
                      onChange={setDate}
                    />
                  )}
                </Field>
              </div>

              <Field label="Note" hint="Optional — e.g. “Venmo for the cabin”.">
                {(id) => (
                  <Input
                    id={id}
                    value={note}
                    maxLength={LIMITS.NOTES_MAX}
                    placeholder="Add a note"
                    disabled={createSettlement.isPending}
                    onChange={(e) => setNote(e.target.value)}
                  />
                )}
              </Field>
            </>
          )}
        </DialogBody>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={createSettlement.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" loading={createSettlement.isPending} disabled={!valid}>
            Record payment
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
