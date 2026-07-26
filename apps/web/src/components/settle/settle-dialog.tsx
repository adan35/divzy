'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeftRight, Check, Copy, FileText, MoveRight, Paperclip, Share2, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import {
  LIMITS,
  SETTLEMENT_METHODS,
  formatMoney,
  type FriendDto,
  type GroupBalancesDto,
  type PairwiseDebt,
  type PublicUserDto,
  type SettlementMethod,
} from '@divzy/shared';
import {
  errorMessage,
  useCreateSettlement,
  useFriends,
  useGroup,
  useGroupBalances,
  useUploadReceipt,
} from '@/lib/hooks';
import { useAuth } from '@/lib/auth-store';
import { apiUrl } from '@/lib/api';
import { celebrate } from '@/lib/celebrate';
import { copyToClipboard } from '@/lib/clipboard';
import { AmountInput } from '@/components/ui/amount-input';
import { Avatar } from '@/components/ui/avatar';
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
import { Field, Input } from '@/components/ui/input';
import { MoneyText } from '@/components/ui/money-text';
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
  /**
   * WI-086: open the group-scoped dialog in debt-list mode when there is no
   * prefill. Default 'form' preserves every existing entry point.
   */
  initialView?: 'list' | 'form';
}

/**
 * WI-012 (non-group entry points): when a friend has exactly one native
 * (unconverted) leftover currency, that IS a real per-currency directional
 * figure — expressed as a one-row `PairwiseDebt`-shaped list so the exact
 * same lookup/clamp logic used for the group-scoped `pairwise` array below
 * applies uniformly to both scopes. Never reads `balancesConverted` to size
 * this (charter ARCH invariant 5) — only the native `balances` leftover.
 */
function singleNativeFriendDebt(
  friend: FriendDto | undefined,
  meId: string | undefined,
): PairwiseDebt[] {
  if (!friend || !meId || friend.balances.length !== 1) return [];
  const entry = friend.balances[0];
  if (entry.amount === 0) return [];
  return entry.amount > 0
    ? [
        {
          currency: entry.currency,
          fromUserId: friend.user.id,
          toUserId: meId,
          amount: entry.amount,
        },
      ]
    : [
        {
          currency: entry.currency,
          fromUserId: meId,
          toUserId: friend.user.id,
          amount: -entry.amount,
        },
      ];
}

/**
 * WI-012 Revision 2 (cycle 1): the group-scoped clamp is no longer a
 * bilateral `pairwise` lookup — that rejected legitimate `suggestSettlements`
 * transfers in 3+-member debt chains, where the suggested pair need not have
 * shared a direct expense/settlement (defect-WI-012.md). Instead it mirrors
 * the server's net-position reachability ceiling exactly: the maximum
 * fromUserId->toUserId transfer any valid settle-up set can route, given
 * each party's net position in this group/currency. Reads native
 * `members[].balances` only — never `convertedNet` (ARCH invariant 5).
 *
 * ADR-011 (WI-013): bilateral pairwise debt and net-position reachability are
 * not point-wise comparable — in a debt chain the net ceiling can be
 * *tighter* than a genuinely-owed bilateral debt, wrongly blocking WI-013's
 * unsimplified ("Simplify debts" OFF) "Record payment" rows. The bound is
 * therefore widened to the union (max) of both, mirroring the server's
 * widened `assertWithinOutstanding`. This is a strict superset of the
 * Revision 2 ceiling alone — every existing WI-012 acceptance still passes
 * (`settleable >= netCeiling` always) — so no new over-payment is admitted;
 * see ADR-011 for the full "why this is a superset" argument. Reads native
 * `pairwise` only — never `convertedAmount` (ARCH invariant 5).
 */
function settleableGroupDebt(
  members: GroupBalancesDto['members'] | undefined,
  pairwise: GroupBalancesDto['pairwise'] | undefined,
  fromUserId: string,
  toUserId: string,
  currency: string,
): PairwiseDebt[] {
  const netOf = (userId: string) =>
    members?.find((m) => m.user.id === userId)?.balances.find((b) => b.currency === currency)
      ?.amount ?? 0;
  const netP = netOf(fromUserId);
  const netR = netOf(toUserId);
  const netCeiling = netP < 0 && netR > 0 ? Math.min(-netP, netR) : 0;
  const bilateral =
    pairwise?.find(
      (d) => d.currency === currency && d.fromUserId === fromUserId && d.toUserId === toUserId,
    )?.amount ?? 0;
  const settleable = Math.max(netCeiling, bilateral);
  return settleable <= 0 ? [] : [{ currency, fromUserId, toUserId, amount: settleable }];
}

/**
 * WI-016 Part B (ADR-013) — the shareable settle-up deep link. No token, no
 * server state: the same non-secret ids/amount/currency/groupId the
 * suggestion/friend entry points already pass in-process today, carried as
 * query params on a Divzy web link. `amount` is integer minor units,
 * matching mobile's existing `app/settle.tsx` param contract exactly, so the
 * same link works on both platforms. `POST /settlements` remains the sole
 * authority — this link is a pure convenience prefill and authorizes nothing
 * on its own.
 */
function buildSettleLink(
  origin: string,
  params: {
    fromUserId: string;
    toUserId: string;
    amount: number;
    currency: string;
    groupId?: string;
  },
): string {
  const qs = new URLSearchParams({
    fromUserId: params.fromUserId,
    toUserId: params.toUserId,
    amount: String(params.amount),
    currency: params.currency,
  });
  if (params.groupId) qs.set('groupId', params.groupId);
  return `${origin}/settle?${qs.toString()}`;
}

/**
 * Record a payment between two people — from a suggestion (prefilled) or from
 * scratch. Parties come from the group's members, or from your friends list
 * for non-group payments. Validates: parties differ, you are involved, amount > 0.
 */
export function SettleUpDialog({
  open,
  onOpenChange,
  groupId,
  prefill,
  initialView = 'form',
}: SettleUpDialogProps) {
  const { user: me } = useAuth();
  const groupQuery = useGroup(groupId ?? '', open && Boolean(groupId));
  const friendsQuery = useFriends();
  const createSettlement = useCreateSettlement();
  // WI-023: optional payment-proof attachment, mirroring the expense
  // editor's receipt upload two-step (upload first, then include the
  // returned URL as `proofUrl` on create).
  const uploadProof = useUploadReceipt();
  const proofFileInputRef = useRef<HTMLInputElement>(null);
  // WI-012: native (never converted) member net positions for the
  // group-scoped clamp (Revision 2 — net-position reachability, not the
  // bilateral pairwise ledger) — same query the Balances tab already
  // fetches, reused here so the dialog carries its own gating regardless of
  // entry point.
  const groupBalancesQuery = useGroupBalances(groupId ?? '', open && Boolean(groupId));

  const [fromUserId, setFromUserId] = useState('');
  const [toUserId, setToUserId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [method, setMethod] = useState<SettlementMethod>('CASH');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString());
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [amountTouched, setAmountTouched] = useState(false);
  const currencyTouched = useRef(false);

  // WI-086: list mode lets the caller pick a debt from the group ledger before
  // switching to the Record-payment form. `activePrefill` merges the prop
  // prefill with a user-selected list row.
  const [mode, setMode] = useState<'list' | 'form'>(
    initialView === 'list' && groupId ? 'list' : 'form',
  );
  const [activePrefill, setActivePrefill] = useState<SettleUpPrefill | undefined>(prefill);

  // WI-016 Part B — shareable settle-up link/QR state.
  const [origin, setOrigin] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const copyLinkTimer = useRef<number | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(
    () => () => {
      if (copyLinkTimer.current !== null) window.clearTimeout(copyLinkTimer.current);
    },
    [],
  );

  const group = groupId ? groupQuery.data : undefined;

  const candidates: PublicUserDto[] = groupId
    ? (group?.members.map((m) => m.user) ?? [])
    : [
        ...(me ? [{ id: me.id, name: me.name, avatarColor: me.avatarColor }] : []),
        ...(friendsQuery.data?.map((f) => f.user) ?? []),
      ];

  // Reset the form each time the dialog opens (prefill wins over defaults).
  // WI-024/ADR-021: only the *override* party state is blanked here — the
  // effective parties are resolved as derived values below, every render, so
  // there is no write-once effect left to go stale on a warm re-open or to
  // overwrite a user's in-progress pick (WI-021).
  useEffect(() => {
    if (!open) return;
    setMode(initialView === 'list' && groupId ? 'list' : 'form');
    setActivePrefill(prefill);
    setFromUserId('');
    setToUserId('');
    setAmount(prefill?.amount ?? null);
    setCurrency(prefill?.currency ?? group?.currency ?? me?.defaultCurrency ?? 'USD');
    setMethod('CASH');
    setNote('');
    setDate(new Date().toISOString());
    setProofUrl(null);
    setAmountTouched(false);
    currencyTouched.current = Boolean(prefill?.currency);
    setShareOpen(false);
    setLinkCopied(false);
    createSettlement.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open
  }, [open]);

  // When an external prefill arrives while the dialog is already open, adopt
  // it and switch to form mode. (List-row selections update activePrefill
  // directly in the click handler, so they do not need this effect.)
  useEffect(() => {
    if (!open) return;
    setActivePrefill(prefill);
    if (prefill) setMode('form');
  }, [prefill, open]);

  // WI-024/ADR-021: derived party resolution. `fromUserId`/`toUserId` state
  // holds the user's explicit override (or '' meaning "no override yet");
  // the resolved values recompute every render from current props/query
  // data, so they are never stale on re-open and never overwrite an
  // in-progress user choice (WI-021).
  // WI-086: `activePrefill` captures a list-row selection; it wins over the
  // prop prefill so the form reflects the latest user pick.
  const effectivePrefill = activePrefill ?? prefill;
  const defaultFrom = effectivePrefill?.fromUserId ?? me?.id ?? '';
  const resolvedFrom = fromUserId || defaultFrom;
  const defaultTo =
    effectivePrefill?.toUserId ?? candidates.find((c) => c.id !== (resolvedFrom || me?.id))?.id ?? '';
  const resolvedTo = toUserId || defaultTo;

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

  const partiesDiffer =
    resolvedFrom !== '' && resolvedTo !== '' && resolvedFrom !== resolvedTo;
  const meInvolved = me !== null && (resolvedFrom === me.id || resolvedTo === me.id);
  const amountValid = amount !== null && amount > 0;
  const partyError = !partiesDiffer
    ? resolvedFrom && resolvedTo
      ? 'Payer and recipient must differ'
      : null
    : !meInvolved
      ? 'You must be the payer or the recipient'
      : null;
  const amountError = amountTouched && !amountValid ? 'Enter an amount greater than zero' : null;

  // ---------------------------------------------------------------------
  // WI-012: bound the amount to the real outstanding balance, per entry
  // point. The server is the enforcement authority regardless — every gate
  // below is affordance only.
  // ---------------------------------------------------------------------
  const counterpartyId = resolvedFrom === me?.id ? resolvedTo : resolvedFrom;
  const friendMatch = !groupId
    ? friendsQuery.data?.find((f) => f.user.id === counterpartyId)
    : undefined;
  const nonGroupNothingOutstanding = friendMatch
    ? friendMatch.balances.length === 0 &&
      (!friendMatch.balancesConverted || friendMatch.balancesConverted.amount === 0)
    : false;

  // The debts we have reliable native, per-currency figures for in this
  // scope: the group's own settleable bound once loaded — the union of net-
  // position reachability (WI-012 Revision 2) and bilateral pairwise debt
  // (ADR-011/WI-013) — or a friend's single native leftover currency. Never
  // `convertedAmount`/`balancesConverted`/`convertedNet`.
  const debts: PairwiseDebt[] = groupId
    ? settleableGroupDebt(
        groupBalancesQuery.data?.members,
        groupBalancesQuery.data?.pairwise,
        resolvedFrom,
        resolvedTo,
        currency,
      )
    : singleNativeFriendDebt(friendMatch, me?.id);

  // Whether we have enough scoped balance info to gate pre-submit at all:
  // group scope always does once its balances query has resolved; non-group
  // scope only does for the zero-balance case or the single-native-currency
  // case (otherwise there's no reliable per-pair figure client-side without
  // reading the forbidden converted figure — block-at-submit covers that).
  const balanceGateActive =
    partiesDiffer &&
    meInvolved &&
    (groupId
      ? groupBalancesQuery.data !== undefined
      : Boolean(friendMatch) && (nonGroupNothingOutstanding || debts.length > 0));

  const debt = balanceGateActive
    ? debts.find(
        (d) =>
          d.currency === currency && d.fromUserId === resolvedFrom && d.toUserId === resolvedTo,
      )
    : undefined;

  const noOutstandingMessage = `Nothing outstanding with ${nameOf(counterpartyId)}${groupId ? ' in this group' : ''}`;
  const balanceError = !balanceGateActive
    ? null
    : !debt
      ? noOutstandingMessage
      : amount !== null && amount > debt.amount
        ? `Only ${formatMoney(debt.amount, currency)} is outstanding`
        : null;
  // Only the "nothing outstanding at all" branch disables the amount field
  // itself (spec: "disable the amount field and submit"); the over-amount
  // branch only blocks submit, keeping the field editable so the user can
  // correct it down to the real balance.
  const amountFieldDisabled = createSettlement.isPending || (balanceGateActive && !debt);

  const valid = partiesDiffer && meInvolved && amountValid && balanceError === null;

  const submitError = createSettlement.isError ? errorMessage(createSettlement.error) : null;

  // WI-016 Part B — once parties/amount/currency are resolved (not gated on
  // meInvolved: a non-party viewing a shared link should still be able to
  // see/re-share the exact same link), reveal the Share affordance. The link
  // carries no secret and authorizes nothing — `POST /settlements` still
  // enforces party/membership/balance regardless of who opens it.
  const canShare = partiesDiffer && amountValid && currency !== '' && amount !== null;
  const shareLink =
    canShare && origin
      ? buildSettleLink(origin, {
          fromUserId: resolvedFrom,
          toUserId: resolvedTo,
          amount: amount as number,
          currency,
          groupId,
        })
      : null;

  const handleCopyLink = async () => {
    if (!shareLink) return;
    const ok = await copyToClipboard(shareLink);
    if (ok) {
      setLinkCopied(true);
      toast.success('Settle-up link copied');
      if (copyLinkTimer.current !== null) window.clearTimeout(copyLinkTimer.current);
      copyLinkTimer.current = window.setTimeout(() => setLinkCopied(false), 2000);
    } else {
      toast.error('Could not copy automatically — select the link and copy it.');
    }
  };

  // WI-023: same PDF-vs-image detection expense's receipt block uses.
  const proofIsPdf = proofUrl !== null && /\.pdf(\?.*)?$/i.test(proofUrl);

  const handleSwap = () => {
    setFromUserId(resolvedTo);
    setToUserId(resolvedFrom);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setAmountTouched(true);
    if (!valid || amount === null || createSettlement.isPending) return;
    const paidAmount = amount;
    const paidCurrency = currency;
    const fromName = nameOf(resolvedFrom);
    const toName = nameOf(resolvedTo);
    createSettlement.mutate(
      {
        groupId: groupId ?? undefined,
        fromUserId: resolvedFrom,
        toUserId: resolvedTo,
        amount: paidAmount,
        currency: paidCurrency,
        method,
        note: note.trim() === '' ? undefined : note.trim(),
        date,
        // WI-023: optional proof URL from the upload step above (spec-WI-023
        // §4.1/§4.3).
        proofUrl: proofUrl ?? undefined,
      },
      {
        onSuccess: () => {
          // WI-068 §7 (AC-7a): settle-up success only, never expense save —
          // fires alongside the existing toast (copy unchanged), skipped
          // entirely under reduced motion (celebrate()'s own concern).
          celebrate();
          toast.success('💸 Payment recorded', {
            description: `${fromName} paid ${toName} ${formatMoney(paidAmount, paidCurrency)}. Feels lighter already.`,
          });
          onOpenChange(false);
        },
      },
    );
  };

  // WI-086: group-scoped debt list rendered before the Record-payment form.
  // It mirrors the Balances tab's actionable section: suggestions when
  // simplifyDebts is ON, pairwise exact debts when OFF.
  const listContent = (() => {
    if (mode !== 'list' || !groupId) return null;
    const groupData = groupQuery.data;
    const balancesData = groupBalancesQuery.data;

    if (!groupData || !balancesData) {
      return (
        <div className="space-y-3 py-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-2/3" />
        </div>
      );
    }

    const simplifyDebts = groupData.simplifyDebts ?? true;
    const actionable = simplifyDebts ? balancesData.suggestions : balancesData.pairwise;

    if (actionable.length === 0) {
      return (
        <Card className="p-6 text-center">
          <div className="text-2xl" aria-hidden="true">
            ✅
          </div>
          <p className="mt-1.5 text-sm font-medium text-ink">All settled up</p>
          <p className="text-[13px] text-ink-3">No one needs to pay anyone in this group.</p>
        </Card>
      );
    }

    return (
      <div className="space-y-2">
        {actionable.map((row) => {
          const canRecord = me?.id === row.fromUserId || me?.id === row.toUserId;
          return (
            <Card
              key={`${row.currency}-${row.fromUserId}-${row.toUserId}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Avatar user={row.from} size="sm" />
                <span className="truncate text-sm font-medium text-ink">{nameOf(row.fromUserId)}</span>
              </span>
              <MoveRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
              <span className="flex min-w-0 items-center gap-2">
                <Avatar user={row.to} size="sm" />
                <span className="truncate text-sm font-medium text-ink">{nameOf(row.toUserId)}</span>
              </span>
              <span className="ml-auto flex items-center gap-3">
                <MoneyText
                  amount={row.amount}
                  currency={row.currency}
                  className="text-sm font-semibold"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canRecord}
                  onClick={() => {
                    const next: SettleUpPrefill = {
                      fromUserId: row.fromUserId,
                      toUserId: row.toUserId,
                      amount: row.amount,
                      currency: row.currency,
                    };
                    setActivePrefill(next);
                    setMode('form');
                    setAmount(next.amount);
                    setCurrency(next.currency);
                    setAmountTouched(false);
                    currencyTouched.current = true;
                  }}
                >
                  Settle
                </Button>
              </span>
            </Card>
          );
        })}
      </div>
    );
  })();

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      ariaLabel={mode === 'list' ? 'Settle Up' : 'Record a payment'}
      dismissible={!createSettlement.isPending}
    >
      {mode === 'list' ? (
        <>
          <DialogHeader>
            <DialogTitle>Settle Up</DialogTitle>
            <DialogDescription>Choose a debt to settle in this group.</DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4 pb-4">{listContent}</DialogBody>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </>
      ) : (
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
                      value={resolvedFrom}
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
                  // WI-068 §4 (web press feedback, transform-only — mirrors
                  // mobile's PressableScale 0.97 press without shifting layout).
                  className="mb-0 shrink-0 px-2.5 transition-transform active:scale-[0.97]"
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
                      value={resolvedTo}
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
                <Field label="Amount" error={amountError ?? balanceError} required>
                  {(id) => (
                    <AmountInput
                      id={id}
                      value={amount}
                      currency={currency}
                      invalid={amountError !== null || balanceError !== null}
                      disabled={amountFieldDisabled}
                      // WI-068 §9.1 "display-size tabular" amount input —
                      // AmountInput's own input/symbol sizing is S1/ui-owned
                      // (no ui/ edits per the S2 boundary); scoped via
                      // Tailwind's arbitrary descendant selectors instead.
                      className="h-12 [&_input]:text-xl [&_input]:font-semibold [&_span]:text-base"
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

              {/* WI-016 Part B (ADR-013) — shareable settle-up link/QR. Shown
                  once parties/amount/currency resolve, regardless of
                  meInvolved: this is a read/share affordance, not a submit
                  path, and the link itself authorizes nothing. */}
              {canShare && (
                <div className="rounded-xl2 border border-hairline bg-surface-2 p-3">
                  <button
                    type="button"
                    onClick={() => setShareOpen((v) => !v)}
                    aria-expanded={shareOpen}
                    className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
                  >
                    <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Share settle-up link
                  </button>
                  {shareOpen && shareLink && (
                    <div className="mt-3 flex flex-col items-center gap-3">
                      <div className="rounded-lg bg-white p-2">
                        <QRCodeSVG value={shareLink} size={160} />
                      </div>
                      <div className="flex w-full items-center gap-2">
                        <Input
                          value={shareLink}
                          readOnly
                          onFocus={(e) => e.currentTarget.select()}
                          className="flex-1 font-mono text-[12px]"
                          aria-label="Settle-up link"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => void handleCopyLink()}
                        >
                          {linkCopied ? (
                            <Check className="h-4 w-4 text-pos" aria-hidden="true" />
                          ) : (
                            <Copy className="h-4 w-4" aria-hidden="true" />
                          )}
                          {linkCopied ? 'Copied' : 'Copy link'}
                        </Button>
                      </div>
                      <p className="text-[12px] text-ink-3">
                        Opens Divzy pre-filled with this payment — no money moves until it&rsquo;s
                        recorded.
                      </p>
                    </div>
                  )}
                </div>
              )}

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

              {/* WI-023: optional payment-proof attachment — same
                  upload-then-attach two-step as the expense editor's
                  receipt control (expense-editor.tsx), reusing the exact
                  same generic upload endpoint (`useUploadReceipt`). No
                  edit/replace after create — this is create-time only. */}
              <div className="flex items-center gap-2">
                {proofUrl ? (
                  <span className="inline-flex items-center gap-2 rounded-xl border border-hairline p-1.5 pr-2">
                    {proofIsPdf ? (
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
                        <FileText className="h-4 w-4" aria-hidden="true" />
                      </span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={apiUrl(proofUrl)}
                        alt="Payment proof"
                        className="h-9 w-9 rounded-lg border border-hairline object-cover"
                      />
                    )}
                    <a
                      href={apiUrl(proofUrl)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[13px] font-medium text-brand hover:underline"
                    >
                      Proof attached
                    </a>
                    <button
                      type="button"
                      aria-label="Remove proof"
                      onClick={() => setProofUrl(null)}
                      className="rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={uploadProof.isPending}
                    disabled={createSettlement.isPending}
                    onClick={() => proofFileInputRef.current?.click()}
                  >
                    <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                    Attach proof
                  </Button>
                )}
                <input
                  ref={proofFileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                  aria-label="Upload payment proof"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    uploadProof.mutate(file, { onSuccess: (res) => setProofUrl(res.url) });
                  }}
                />
              </div>

              {/* WI-012: block-at-submit case — no reliable per-currency
                  figure was available client-side to pre-submit clamp (e.g.
                  a non-group friend with 2+ native currencies), so the
                  request was sent and the server's 400 (NO_OUTSTANDING_BALANCE
                  / EXCEEDS_BALANCE, or any other failure) is surfaced here,
                  in-dialog, rather than only as a toast. */}
              {submitError && (
                <p
                  className="rounded-xl border border-hairline bg-neg-soft px-4 py-3 text-sm text-danger"
                  role="alert"
                >
                  {submitError}
                </p>
              )}
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
      )}
    </Dialog>
  );
}
