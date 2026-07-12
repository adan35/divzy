'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { ExpenseEditorDialog } from '@/components/expenses/expense-editor';
import { ExpenseList } from '@/components/expenses/expense-list';

export default function ExpensesPage() {
  const [editorOpen, setEditorOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="All expenses"
        subtitle="Everything you've paid for or shared, across groups and friends."
        actions={
          <Button onClick={() => setEditorOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add expense
          </Button>
        }
      />
      <ExpenseList emptyHint="Add your first expense to start tracking who owes what." />
      <ExpenseEditorDialog open={editorOpen} onOpenChange={setEditorOpen} />
    </>
  );
}
