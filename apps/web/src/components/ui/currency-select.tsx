'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { CURRENCIES, getCurrency } from '@divzy/shared';
import { cn } from '@/lib/utils';

export interface CurrencySelectProps {
  value: string;
  onChange: (code: string) => void;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}

/** Searchable dropdown over the shared supported-currency list. */
export function CurrencySelect({
  value,
  onChange,
  id,
  disabled,
  invalid,
  className,
}: CurrencySelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = getCurrency(value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CURRENCIES;
    return CURRENCIES.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.symbol.toLowerCase().includes(q),
    );
  }, [query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHighlight(0);
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);

    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const item = listRef.current?.children[highlight] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const pick = (code: string) => {
    onChange(code);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[highlight];
      if (item) pick(item.code);
    }
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-[10px] border border-hairline bg-surface px-3 text-sm text-ink',
          'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft',
          'disabled:cursor-not-allowed disabled:opacity-55',
          invalid && 'border-danger',
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-ink-3">{selected.symbol}</span>
          <span className="truncate font-medium">{selected.code}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
      </button>

      {open && (
        <div
          className="animate-pop-in absolute left-0 z-50 mt-1.5 w-full min-w-[240px] overflow-hidden rounded-xl border border-hairline bg-surface shadow-lg dark:shadow-none"
          onKeyDown={onKeyDown}
        >
          <div className="flex items-center gap-2 border-b border-hairline px-3">
            <Search className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search currencies…"
              aria-label="Search currencies"
              className="h-10 w-full bg-transparent text-sm text-ink placeholder:text-ink-3 focus:outline-none"
            />
          </div>
          <ul
            ref={listRef}
            role="listbox"
            aria-label="Currency"
            className="scrollbar-thin max-h-64 overflow-y-auto py-1"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-ink-3">No currencies match</li>
            )}
            {filtered.map((c, i) => (
              <li key={c.code} role="option" aria-selected={c.code === value}>
                <button
                  type="button"
                  onClick={() => pick(c.code)}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm',
                    i === highlight ? 'bg-surface-2 text-ink' : 'text-ink-2',
                  )}
                >
                  <span className="w-8 shrink-0 text-ink-3">{c.symbol}</span>
                  <span className="font-medium text-ink">{c.code}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-3">{c.name}</span>
                  {c.code === value && (
                    <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
