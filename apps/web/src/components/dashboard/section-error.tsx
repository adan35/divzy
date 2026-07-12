'use client';

import { AlertCircle, RotateCcw } from 'lucide-react';
import { errorMessage } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export interface SectionErrorProps {
  error: unknown;
  onRetry: () => void;
  className?: string;
}

/** Compact inline error card with retry, for individual dashboard sections. */
export function SectionError({ error, onRetry, className }: SectionErrorProps) {
  return (
    <Card className={cn('flex flex-col items-center gap-2.5 p-6 text-center', className)}>
      <AlertCircle className="h-5 w-5 text-danger" aria-hidden="true" />
      <p className="max-w-sm text-sm text-ink-2">{errorMessage(error)}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        Try again
      </Button>
    </Card>
  );
}
