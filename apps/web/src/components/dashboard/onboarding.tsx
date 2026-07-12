'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ExpenseEditorDialog } from '@/components/expenses/expense-editor';

/** Big friendly first-run card shown when a brand-new user has no data yet. */
export function OnboardingCard({ firstName }: { firstName: string }) {
  const router = useRouter();
  const [expenseOpen, setExpenseOpen] = useState(false);

  return (
    <>
      <Card className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <span className="text-5xl" aria-hidden="true">
          ✈️
        </span>
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-ink">
          Welcome to divzy{firstName ? `, ${firstName}` : ''}!
        </h2>
        <p className="max-w-md text-sm leading-relaxed text-ink-2">
          Split expenses with roommates, trips and friends — divzy keeps score so you
          don&rsquo;t have to. Start with a group, or jump straight into your first
          expense.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          <Button size="lg" onClick={() => router.push('/groups?new=1')}>
            <Users className="h-4 w-4" aria-hidden="true" />
            Create your first group
          </Button>
          <Button size="lg" variant="secondary" onClick={() => setExpenseOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add an expense
          </Button>
        </div>
      </Card>
      <ExpenseEditorDialog open={expenseOpen} onOpenChange={setExpenseOpen} />
    </>
  );
}
