'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { FileText, Pencil, RotateCcw, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  categoryInfo,
  formatMoney,
  LIMITS,
  type ExpenseDto,
  type ExpenseFieldChange,
  type ExpenseRevisionDto,
  type ExpenseSplitDto,
  type PublicUserDto,
} from '@divzy/shared';
import { apiUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth-store';
import {
  errorMessage,
  useAddComment,
  useComments,
  useExpense,
  useExpenseHistory,
  useRestoreExpense,
} from '@/lib/hooks';
import { formatDate, formatDateFull, formatRelative } from '@/lib/format';
import { ExpenseSplitChart } from '@/components/analytics/expense-split-chart';
import { Avatar, AvatarStack } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MoneyText } from '@/components/ui/money-text';
import { Skeleton } from '@/components/ui/skeleton';
import { DeleteExpenseDialog } from './delete-expense-dialog';
import { ExpenseEditorDialog } from './expense-editor';

export interface ExpenseDetailDialogProps {
  expenseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">{children}</p>
  );
}

// WI-017: history copy templates. Verbatim contract shared with mobile
// (apps/mobile/app/expense/[id].tsx) — keep both in lockstep.
const SPLIT_TYPE_LABELS: Record<ExpenseDto['splitType'], string> = {
  EQUAL: 'Split equally',
  EXACT: 'Exact amounts',
  PERCENT: 'By percentage',
  SHARES: 'By shares',
  ADJUSTMENT: 'With adjustments',
  ITEMIZED: 'Itemized',
};

function splitLabel(splitType: ExpenseDto['splitType']): string {
  return SPLIT_TYPE_LABELS[splitType] ?? splitType;
}

function truncate(value: string, max = 40): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** One history line per changed field — the shared web/mobile copy contract. */
function historyChangeText(change: ExpenseFieldChange): string {
  switch (change.field) {
    case 'description':
      return `changed description: "${truncate(change.from)}" → "${truncate(change.to)}"`;
    case 'amount':
      return `changed amount from ${formatMoney(change.from, change.fromCurrency)} to ${formatMoney(change.to, change.toCurrency)}`;
    case 'currency':
      return `changed currency from ${change.from} to ${change.to}`;
    case 'category':
      return `changed category from ${categoryInfo(change.from).label} to ${categoryInfo(change.to).label}`;
    case 'date':
      return `changed date from ${formatDate(change.from)} to ${formatDate(change.to)}`;
    case 'splitType':
      return `changed split from ${splitLabel(change.from)} to ${splitLabel(change.to)}`;
    case 'notes':
      return `notes ${change.change}`;
    case 'receiptUrl':
      return `receipt ${change.change}`;
    default:
      return '';
  }
}

/**
 * WI-058: the one genuinely non-redundant thing the old per-person list
 * carried, preserved as the raw split *input* (never the chart's computed
 * percent — those can legitimately differ, e.g. a 25% input vs. a
 * largest-remainder share). EQUAL/EXACT/ITEMIZED have no mechanics, so
 * `null` for all their splits — the strip renders nothing in that case.
 */
function splitMechanics(
  splitType: ExpenseDto['splitType'],
  split: ExpenseSplitDto,
  currency: string,
): string | null {
  switch (splitType) {
    case 'PERCENT':
      return split.percentBps !== null ? `${split.percentBps / 100}%` : null;
    case 'SHARES':
      return split.shares !== null
        ? `${split.shares} ${split.shares === 1 ? 'share' : 'shares'}`
        : null;
    case 'ADJUSTMENT':
      return split.adjustment !== null && split.adjustment !== 0
        ? `${split.adjustment > 0 ? '+' : '−'}${formatMoney(Math.abs(split.adjustment), currency)}`
        : null;
    default:
      return null;
  }
}

/** My position on this expense: what I paid minus my share. */
function myLens(expense: ExpenseDto, meId: string | undefined) {
  if (!meId) return { involved: false, net: 0 };
  const paid = expense.payers
    .filter((p) => p.user.id === meId)
    .reduce((acc, p) => acc + p.amount, 0);
  const split = expense.splits.find((s) => s.user.id === meId);
  const involved = paid > 0 || split !== undefined;
  return { involved, net: paid - (split?.amount ?? 0) };
}

/**
 * Full expense breakdown: amount hero, payers, splits, items (ITEMIZED),
 * receipt, notes, audit trail, edit/delete actions and comments.
 */
export function ExpenseDetailDialog({ expenseId, open, onOpenChange }: ExpenseDetailDialogProps) {
  const { user: me } = useAuth();
  const [mode, setMode] = useState<'view' | 'edit' | 'delete'>('view');
  const expenseQuery = useExpense(expenseId, open);
  const commentsQuery = useComments(expenseId, open);
  const historyQuery = useExpenseHistory(expenseId, open);
  const addComment = useAddComment();
  const restoreExpense = useRestoreExpense();
  const [commentBody, setCommentBody] = useState('');

  // Fresh state every time the dialog is (re)opened for a different expense.
  useEffect(() => {
    if (!open) {
      setMode('view');
      setCommentBody('');
    }
  }, [open]);

  const expense = expenseQuery.data;
  const lens = expense ? myLens(expense, me?.id) : null;

  const userById = useMemo(() => {
    const map = new Map<string, PublicUserDto>();
    if (expense) {
      for (const p of expense.payers) map.set(p.user.id, p.user);
      for (const s of expense.splits) map.set(s.user.id, s.user);
    }
    return map;
  }, [expense]);

  // WI-058: mechanics strip lines — one per split whose splitType-specific
  // raw input is non-null. Empty for EQUAL/EXACT/ITEMIZED, so the strip
  // renders nothing for those types.
  const splitMechanicsLines = useMemo(() => {
    if (!expense) return [];
    return expense.splits
      .map((split) => ({
        split,
        mechanic: splitMechanics(expense.splitType, split, expense.currency),
      }))
      .filter(
        (entry): entry is { split: ExpenseSplitDto; mechanic: string } => entry.mechanic !== null,
      );
  }, [expense]);

  const cat = expense ? categoryInfo(expense.category) : null;
  const itemsTotal = expense ? expense.items.reduce((acc, i) => acc + i.amount, 0) : 0;
  const fee = expense ? expense.amount - itemsTotal : 0;
  const receiptIsPdf = !!expense?.receiptUrl && /\.pdf(\?.*)?$/i.test(expense.receiptUrl);
  const wasEdited =
    !!expense?.updatedBy && expense.updatedAt !== expense.createdAt;

  const sendComment = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const body = commentBody.trim();
    if (!body || addComment.isPending || !expense) return;
    addComment.mutate(
      { expenseId: expense.id, body },
      { onSuccess: () => setCommentBody('') },
    );
  };

  const comments = commentsQuery.data ?? [];
  const history: ExpenseRevisionDto[] = historyQuery.data ?? [];

  return (
    <>
      <Dialog
        open={open && mode === 'view'}
        onOpenChange={onOpenChange}
        size="lg"
        ariaLabel="Expense details"
      >
        {expenseQuery.isLoading ? (
          <>
            <DialogHeader>
              <Skeleton className="h-6 w-2/5" />
              <Skeleton className="h-4 w-1/4" />
            </DialogHeader>
            <DialogBody className="space-y-4 pb-6" aria-hidden="true">
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </DialogBody>
          </>
        ) : expenseQuery.isError || !expense ? (
          <>
            <DialogHeader>
              <DialogTitle>Expense</DialogTitle>
            </DialogHeader>
            <DialogBody className="pb-4">
              <p className="rounded-xl border border-hairline bg-neg-soft px-4 py-3 text-sm text-neg" role="alert">
                {expenseQuery.error ? errorMessage(expenseQuery.error) : 'This expense could not be loaded.'}
              </p>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => void expenseQuery.refetch()}>
                Try again
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-xl"
                >
                  {cat?.emoji}
                </span>
                <div className="min-w-0">
                  <DialogTitle className="break-words">{expense.description}</DialogTitle>
                  <DialogDescription>
                    {cat?.label} · {formatDateFull(expense.date)}
                    {expense.group && (
                      <> · {expense.group.emoji} {expense.group.name}</>
                    )}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <DialogBody className="space-y-5 pb-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-col gap-0.5">
                  <MoneyText
                    amount={expense.amount}
                    currency={expense.currency}
                    className="text-3xl font-semibold tracking-tight text-ink"
                  />
                  {/* Converted equivalent (WI-014) — omitted, not zeroed, when
                      the server couldn't resolve a rate for this expense. */}
                  {expense.convertedAmount !== undefined && (
                    <span className="flex items-center gap-1 text-sm text-ink-3">
                      <span aria-hidden="true">≈</span>
                      <MoneyText amount={expense.convertedAmount} currency={expense.convertedCurrency!} />
                      {expense.isApproximateRate && (
                        <span
                          className="font-semibold text-warn"
                          title="Approximate — today's rate; the rate on this expense's date isn't available"
                          aria-label="Approximate — today's rate; the rate on this expense's date isn't available"
                        >
                          *
                        </span>
                      )}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  {expense.deletedAt && <Badge variant="neg">Deleted</Badge>}
                  {lens &&
                    (!lens.involved ? (
                      <Badge>You&rsquo;re not involved</Badge>
                    ) : lens.net === 0 ? (
                      <Badge>No balance for you</Badge>
                    ) : lens.net > 0 ? (
                      <span className="flex flex-col items-end gap-0.5">
                        {/* Sentence-embedded amount (spec-WI-068 AC-4a documented exception,
                            mirrored in expense-list.tsx's row lens): a single flowing phrase
                            inside one Badge text node, not a nested <MoneyText>, so this
                            standalone figure never spuriously collides with an unrelated
                            equal-amount row elsewhere on the same dialog (e.g. a split whose
                            amount happens to equal this net) under getByText's per-element
                            text matching. */}
                        <Badge variant="pos">You lent {formatMoney(lens.net, expense.currency)}</Badge>
                        <span className="text-[11px] leading-tight text-ink-3">at the time</span>
                      </span>
                    ) : (
                      <span className="flex flex-col items-end gap-0.5">
                        <Badge variant="neg">
                          You borrowed {formatMoney(-lens.net, expense.currency)}
                        </Badge>
                        <span className="text-[11px] leading-tight text-ink-3">at the time</span>
                      </span>
                    ))}
                </span>
              </div>

              <div>
                <SectionLabel>Paid by</SectionLabel>
                <ul className="space-y-1.5">
                  {expense.payers.map((payer) => (
                    <li key={payer.user.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Avatar user={payer.user} size="sm" />
                        <span className="truncate text-ink">
                          {payer.user.id === me?.id ? 'You' : payer.user.name}
                        </span>
                      </span>
                      <MoneyText
                        amount={payer.amount}
                        currency={expense.currency}
                        className="font-medium text-ink"
                      />
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <SectionLabel>Split · {expense.splitType.toLowerCase()}</SectionLabel>
                {/* Analytics-owned chart slot (WI-039 fast-follow, ADR-022) —
                    props sourced verbatim from `expense`; component itself is
                    analytics-owned and untouched here. */}
                <ExpenseSplitChart
                  currency={expense.currency}
                  splits={expense.splits}
                  totalAmount={expense.amount}
                  viewerUserId={me?.id}
                  className="mb-3"
                />
                {/* WI-058: the chart above is the sole source of per-person
                    amount + percent; this strip carries only the
                    non-redundant splitType-specific mechanics (raw input),
                    no avatar and no owed-amount. Renders nothing for
                    EQUAL/EXACT/ITEMIZED — the chart alone is the whole
                    section for those types. */}
                {splitMechanicsLines.length > 0 && (
                  <ul className="space-y-1 text-xs text-ink-3" data-testid="split-mechanics">
                    {splitMechanicsLines.map(({ split, mechanic }) => (
                      <li key={split.user.id}>
                        {split.user.id === me?.id ? 'You' : split.user.name} · {mechanic}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {expense.splitType === 'ITEMIZED' && expense.items.length > 0 && (
                <div>
                  <SectionLabel>Items</SectionLabel>
                  <div className="overflow-x-auto rounded-xl border border-hairline">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-hairline text-left text-xs text-ink-3">
                          <th className="px-3 py-2 font-medium">Item</th>
                          <th className="px-3 py-2 font-medium">For</th>
                          <th className="px-3 py-2 text-right font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-hairline">
                        {expense.items.map((item) => (
                          <tr key={item.id}>
                            <td className="px-3 py-2 text-ink">{item.name}</td>
                            <td className="px-3 py-2">
                              <AvatarStack
                                size="xs"
                                users={item.participantIds
                                  .map((id) => userById.get(id))
                                  .filter((u): u is PublicUserDto => !!u)}
                              />
                            </td>
                            <td className="px-3 py-2 text-right text-ink">
                              <MoneyText amount={item.amount} currency={expense.currency} />
                            </td>
                          </tr>
                        ))}
                        {fee > 0 && (
                          <tr>
                            <td className="px-3 py-2 text-ink-2">Tax, tip &amp; fees</td>
                            <td className="px-3 py-2 text-xs text-ink-3">split proportionally</td>
                            <td className="px-3 py-2 text-right text-ink">
                              <MoneyText amount={fee} currency={expense.currency} />
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {expense.receiptUrl && (
                <div>
                  <SectionLabel>Receipt</SectionLabel>
                  <a
                    href={apiUrl(expense.receiptUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-3 rounded-xl border border-hairline p-2 pr-3 transition-colors hover:bg-surface-2"
                  >
                    {receiptIsPdf ? (
                      <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
                        <FileText className="h-6 w-6" aria-hidden="true" />
                      </span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={apiUrl(expense.receiptUrl)}
                        alt="Receipt"
                        className="h-14 w-14 rounded-lg border border-hairline object-cover"
                      />
                    )}
                    <span className="text-sm font-medium text-brand">
                      View receipt{receiptIsPdf ? ' (PDF)' : ''}
                    </span>
                  </a>
                </div>
              )}

              {expense.notes && (
                <div>
                  <SectionLabel>Notes</SectionLabel>
                  <p className="whitespace-pre-wrap text-sm text-ink-2">{expense.notes}</p>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
                <div className="text-xs text-ink-3">
                  <p>
                    Added by {expense.createdBy.id === me?.id ? 'you' : expense.createdBy.name} ·{' '}
                    {formatDate(expense.createdAt)}
                  </p>
                  {wasEdited && expense.updatedBy && (
                    <p>
                      Edited by {expense.updatedBy.id === me?.id ? 'you' : expense.updatedBy.name} ·{' '}
                      {formatRelative(expense.updatedAt)}
                    </p>
                  )}
                </div>
                {!expense.deletedAt && (
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setMode('edit')}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger hover:bg-neg-soft hover:text-danger"
                      onClick={() => setMode('delete')}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Delete
                    </Button>
                  </div>
                )}
                {/* WI-054b: any viewer who can open the dialog can already see
                    the expense, and visibility is this domain's entire
                    authorization decision (no creator/admin gate) — so no
                    extra client-side role check is needed here, matching the
                    Edit/Delete gating above. Restore is a safe, reversible
                    undo, so unlike Delete it has no confirmation step. */}
                {expense.deletedAt && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={restoreExpense.isPending}
                      onClick={() =>
                        restoreExpense.mutate(
                          { expenseId: expense.id, groupId: expense.groupId },
                          { onSuccess: () => toast.success(`${expense.description} restored`) },
                        )
                      }
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      Restore
                    </Button>
                  </div>
                )}
              </div>

              <div className="border-t border-hairline pt-4">
                <SectionLabel>History</SectionLabel>
                {historyQuery.isLoading ? (
                  <div className="space-y-3" aria-hidden="true">
                    <Skeleton className="h-4 w-3/5" />
                    <Skeleton className="h-4 w-2/5" />
                  </div>
                ) : historyQuery.isError ? (
                  <p className="text-sm text-ink-3">{errorMessage(historyQuery.error)}</p>
                ) : history.length === 0 ? (
                  <p className="text-sm text-ink-3">No history yet</p>
                ) : (
                  <ul className="space-y-3">
                    {history.map((revision) => (
                      <li key={revision.id} className="flex gap-2.5" data-testid="history-entry">
                        <Avatar user={revision.actor} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-baseline gap-2">
                            <span className="text-[13px] font-medium text-ink">
                              {revision.actor.id === me?.id ? 'You' : revision.actor.name}
                            </span>
                            <span className="text-xs text-ink-3">
                              {formatRelative(revision.createdAt)}
                            </span>
                          </p>
                          {revision.kind === 'CREATED' ? (
                            <p className="text-sm text-ink-2">created this expense</p>
                          ) : (
                            <ul className="list-disc space-y-0.5 pl-4 text-sm text-ink-2">
                              {revision.changes.map((change, i) => (
                                <li key={`${revision.id}-${change.field}-${i}`}>
                                  {historyChangeText(change)}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="border-t border-hairline pt-4">
                <SectionLabel>
                  Comments{comments.length > 0 ? ` (${comments.length})` : ''}
                </SectionLabel>
                {commentsQuery.isLoading ? (
                  <div className="space-y-3" aria-hidden="true">
                    <Skeleton className="h-4 w-3/5" />
                    <Skeleton className="h-4 w-2/5" />
                  </div>
                ) : commentsQuery.isError ? (
                  <p className="text-sm text-ink-3">{errorMessage(commentsQuery.error)}</p>
                ) : comments.length === 0 ? (
                  <p className="text-sm text-ink-3">No comments yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {comments.map((comment) => (
                      <li key={comment.id} className="flex gap-2.5">
                        <Avatar user={comment.author} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-baseline gap-2">
                            <span className="text-[13px] font-medium text-ink">
                              {comment.author.id === me?.id ? 'You' : comment.author.name}
                            </span>
                            <span className="text-xs text-ink-3">
                              {formatRelative(comment.createdAt)}
                            </span>
                          </p>
                          <p className="whitespace-pre-wrap break-words text-sm text-ink-2">
                            {comment.body}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <form onSubmit={sendComment} className="mt-3 flex items-center gap-2">
                  <Input
                    value={commentBody}
                    maxLength={LIMITS.COMMENT_MAX}
                    placeholder="Add a comment…"
                    aria-label="Add a comment"
                    onChange={(e) => setCommentBody(e.target.value)}
                  />
                  <Button
                    type="submit"
                    aria-label="Send comment"
                    loading={addComment.isPending}
                    disabled={commentBody.trim().length === 0}
                    className="shrink-0"
                  >
                    <Send className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </form>
              </div>
            </DialogBody>
          </>
        )}
      </Dialog>

      {/* Edit — the detail dialog steps aside while the editor is up. */}
      {expense && (
        <ExpenseEditorDialog
          open={open && mode === 'edit'}
          onOpenChange={(o) => {
            if (!o) setMode('view');
          }}
          expense={expense}
          onSaved={() => setMode('view')}
        />
      )}

      {/* Delete confirmation (WI-039: host-agnostic unit) — reproduces
          today's exact toast + close behavior via onDeleted. */}
      <DeleteExpenseDialog
        expenseId={expenseId}
        expense={expense}
        open={open && mode === 'delete'}
        onOpenChange={(o) => {
          if (!o) setMode('view');
        }}
        onDeleted={() => {
          if (expense) toast.success(`${expense.description} deleted`);
          onOpenChange(false);
        }}
      />
    </>
  );
}
