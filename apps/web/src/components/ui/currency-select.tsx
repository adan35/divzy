'use client';

import { Check, ChevronDown } from 'lucide-react';
import { CURRENCIES, getCurrency, type CurrencyInfo } from '@divzy/shared';
import { SearchSelect } from './search-select';

export interface CurrencySelectProps {
  value: string;
  onChange: (code: string) => void;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}

/**
 * Searchable dropdown over the shared supported-currency list. Thin wrapper
 * over the generic `SearchSelect<T>` core (WI-042) — public props and
 * behavior unchanged from before the generalization.
 */
export function CurrencySelect({
  value,
  onChange,
  id,
  disabled,
  invalid,
  className,
}: CurrencySelectProps) {
  return (
    <SearchSelect<CurrencyInfo>
      id={id}
      disabled={disabled}
      invalid={invalid}
      className={className}
      items={CURRENCIES}
      value={value}
      onChange={onChange}
      getKey={(c) => c.code}
      getSearchText={(c) => `${c.code} ${c.name} ${c.symbol}`}
      searchPlaceholder="Search currencies…"
      searchAriaLabel="Search currencies"
      emptyLabel="No currencies match"
      listAriaLabel="Currency"
      renderTrigger={() => {
        const selected = getCurrency(value);
        return (
          <>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="text-ink-3">{selected.symbol}</span>
              <span className="truncate font-medium">{selected.code}</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
          </>
        );
      }}
      renderRow={(c, { selected }) => (
        <>
          <span className="w-8 shrink-0 text-ink-3">{c.symbol}</span>
          <span className="font-medium text-ink">{c.code}</span>
          <span className="min-w-0 flex-1 truncate text-ink-3">{c.name}</span>
          {selected && <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />}
        </>
      )}
    />
  );
}
