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
      {/* WI-068 §2 type scale: section labels are 12px/600/uppercase/+0.06em, ink-3. */}
      <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-3">{title}</h2>
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
