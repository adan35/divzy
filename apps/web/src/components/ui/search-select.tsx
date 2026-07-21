'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SearchSelectProps<T> {
  items: readonly T[];
  value: string | null;
  onChange: (key: string) => void;
  getKey: (item: T) => string;
  /** Lowercased + `.includes()` matched (D2 — plain substring, no accent folding). */
  getSearchText: (item: T) => string;
  renderRow: (item: T, state: { active: boolean; selected: boolean }) => ReactNode;
  /** Closed-button content. */
  renderTrigger: (selected: T | undefined) => ReactNode;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  /** "No results" copy (D6). */
  emptyLabel?: string;
  listAriaLabel?: string;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}

/**
 * Generic searchable-popover core (WI-042), generalized from
 * `currency-select.tsx`'s original mechanics: popover open/close,
 * outside-click dismissal, focus-search-on-open, `role="listbox"`,
 * Arrow/Enter/Escape keyboard nav, highlight scroll-into-view. Every
 * per-use-case concern (data, key/label/search extraction, row markup) is
 * supplied by the caller — `CurrencySelect` and the expense editor's
 * group/friend picker are thin wrappers over this core.
 */
export function SearchSelect<T>({
  items,
  value,
  onChange,
  getKey,
  getSearchText,
  renderRow,
  renderTrigger,
  searchPlaceholder,
  searchAriaLabel,
  emptyLabel = 'No results',
  listAriaLabel,
  id,
  disabled,
  invalid,
  className,
}: SearchSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = useMemo(() => items.find((i) => getKey(i) === value), [items, getKey, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => getSearchText(i).toLowerCase().includes(q));
  }, [items, getSearchText, query]);

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

  const pick = (key: string) => {
    onChange(key);
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
      if (item) pick(getKey(item));
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
          'flex h-10 w-full items-center justify-between gap-2 rounded-[10px] border border-hairline-strong bg-surface px-3 text-sm text-ink',
          'focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft',
          'disabled:cursor-not-allowed disabled:opacity-55',
          invalid && 'border-danger',
        )}
      >
        {renderTrigger(selected)}
      </button>

      {open && (
        <div
          className="animate-pop-in absolute left-0 z-50 mt-1.5 w-full min-w-[240px] overflow-hidden rounded-xl border border-hairline bg-elevated shadow-pop dark:shadow-top-edge"
          onKeyDown={onKeyDown}
        >
          <div className="flex items-center gap-2 border-b border-hairline px-3">
            <Search className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchAriaLabel}
              className="h-10 w-full bg-transparent text-sm text-ink placeholder:text-ink-3 focus:outline-none"
            />
          </div>
          <ul
            ref={listRef}
            role="listbox"
            aria-label={listAriaLabel}
            className="scrollbar-thin max-h-64 overflow-y-auto py-1"
          >
            {filtered.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-ink-3">{emptyLabel}</li>
            )}
            {filtered.map((item, i) => {
              const key = getKey(item);
              return (
                <li key={key} role="option" aria-selected={key === value}>
                  <button
                    type="button"
                    onClick={() => pick(key)}
                    onMouseEnter={() => setHighlight(i)}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm',
                      i === highlight ? 'bg-surface-2 text-ink' : 'text-ink-2',
                    )}
                  >
                    {renderRow(item, { active: i === highlight, selected: key === value })}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
