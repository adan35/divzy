'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SectionHeaderProps {
  title: string;
  /** When set, renders a "See all" link on the right. */
  href?: string;
  linkLabel?: string;
  className?: string;
}

export function SectionHeader({
  title,
  href,
  linkLabel = 'See all',
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {href && (
        <Link
          href={href}
          className="inline-flex items-center gap-0.5 text-[13px] font-medium text-brand transition-colors hover:text-brand-hover"
        >
          {linkLabel}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
