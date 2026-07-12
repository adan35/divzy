'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { HandCoins, Plus, Users } from 'lucide-react';
import { ExpenseEditorDialog } from '@/components/expenses/expense-editor';
import { SettleUpDialog } from '@/components/settle/settle-dialog';

const ACTION_CLASS =
  'flex items-center gap-3 rounded-xl2 border border-hairline bg-surface p-4 text-left shadow-sm transition-colors hover:bg-surface-2 dark:shadow-none';

function ActionIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-soft text-brand">
      {children}
    </span>
  );
}

/** Quick actions: add expense, settle up, new group. */
export function QuickActions() {
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        <button type="button" className={ACTION_CLASS} onClick={() => setExpenseOpen(true)}>
          <ActionIcon>
            <Plus className="h-[18px] w-[18px]" aria-hidden="true" />
          </ActionIcon>
          <span className="text-sm font-medium text-ink">Add expense</span>
        </button>

        <button type="button" className={ACTION_CLASS} onClick={() => setSettleOpen(true)}>
          <ActionIcon>
            <HandCoins className="h-[18px] w-[18px]" aria-hidden="true" />
          </ActionIcon>
          <span className="text-sm font-medium text-ink">Settle up</span>
        </button>

        <Link href="/groups?new=1" className={ACTION_CLASS}>
          <ActionIcon>
            <Users className="h-[18px] w-[18px]" aria-hidden="true" />
          </ActionIcon>
          <span className="text-sm font-medium text-ink">New group</span>
        </Link>
      </div>

      <ExpenseEditorDialog open={expenseOpen} onOpenChange={setExpenseOpen} />
      <SettleUpDialog open={settleOpen} onOpenChange={setSettleOpen} />
    </div>
  );
}
