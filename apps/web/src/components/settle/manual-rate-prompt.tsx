'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { CurrencyAmount } from '@divzy/shared';
import { errorMessage, useCreateManualRate } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';

const SHOWN_KEY_PREFIX = 'divzy:manual-rate-shown:';

function pairKey(from: string, to: string): string {
  return `${from}->${to}`;
}

/** sessionStorage is unavailable in private-mode browsers — never throw. */
function hasBeenShown(key: string): boolean {
  try {
    return sessionStorage.getItem(SHOWN_KEY_PREFIX + key) === '1';
  } catch {
    return false;
  }
}

function markShown(key: string): void {
  try {
    sessionStorage.setItem(SHOWN_KEY_PREFIX + key, '1');
  } catch {
    // Storage unavailable — the prompt may reappear this session; harmless.
  }
}

export interface ManualRatePromptsProps {
  /** Native-currency amounts this balance view couldn't auto-convert. */
  unresolved: CurrencyAmount[];
  /** The currency being converted TO (the viewer's default/group currency). */
  viewerCurrency: string;
  /** Called after a rate is saved — re-fetch the triggering balance query. */
  onResolved: () => void;
}

/**
 * Story-WI-002: one-time-per-session manual-rate prompt, shared by the
 * dashboard (`GET /balance`) and group Balances tab (`GET
 * /groups/:groupId/balances`) — both pass their own `unresolved` list here.
 * Shows at most one dialog at a time; a pair is marked shown the instant its
 * dialog opens (not on dismiss-without-opening), so re-renders and repeated
 * `unresolved` entries for an already-shown pair never re-open it this
 * session. Declining leaves that currency's native amount as the caller's
 * own flagged "unconverted" line — this component only owns the prompt.
 */
export function ManualRatePrompts({ unresolved, viewerCurrency, onResolved }: ManualRatePromptsProps) {
  const [active, setActive] = useState<CurrencyAmount | null>(null);
  const openedThisSession = useRef(new Set<string>());

  useEffect(() => {
    if (active) return;
    const next = unresolved.find((entry) => {
      const key = pairKey(entry.currency, viewerCurrency);
      return !hasBeenShown(key) && !openedThisSession.current.has(key);
    });
    if (!next) return;
    const key = pairKey(next.currency, viewerCurrency);
    openedThisSession.current.add(key);
    markShown(key);
    setActive(next);
    // Deliberately re-runs only when the trigger list/target currency
    // change (or the active dialog closes) — not on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unresolved, viewerCurrency, active]);

  if (!active) return null;

  return (
    <ManualRatePromptDialog
      entry={active}
      viewerCurrency={viewerCurrency}
      onOpenChange={(open) => {
        if (!open) setActive(null);
      }}
      onSubmitted={() => {
        setActive(null);
        onResolved();
      }}
    />
  );
}

interface ManualRatePromptDialogProps {
  entry: CurrencyAmount;
  viewerCurrency: string;
  onOpenChange: (open: boolean) => void;
  onSubmitted: () => void;
}

function ManualRatePromptDialog({
  entry,
  viewerCurrency,
  onOpenChange,
  onSubmitted,
}: ManualRatePromptDialogProps) {
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const createManualRate = useCreateManualRate();

  const numeric = Number(value);
  const locallyValid = value.trim() !== '' && Number.isFinite(numeric) && numeric > 0;
  const localError = touched && !locallyValid ? 'Enter a rate greater than zero' : null;
  const serverError = createManualRate.isError ? errorMessage(createManualRate.error) : null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!locallyValid || createManualRate.isPending) return;
    createManualRate.mutate(
      { from: entry.currency, to: viewerCurrency, rate: numeric },
      { onSuccess: onSubmitted },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      size="sm"
      ariaLabel="Supply an exchange rate"
      dismissible={!createManualRate.isPending}
    >
      <form onSubmit={handleSubmit} noValidate>
        <DialogHeader>
          <DialogTitle>We couldn&rsquo;t convert {entry.currency}</DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-4 pb-4">
          {/* WI-068 §9.1: warn-soft banner + icon pairing — color is never
              the only signal (spec §1.1/§12). */}
          <div
            data-testid="manual-rate-warning"
            className="flex items-start gap-2.5 rounded-xl bg-warn-soft p-3 text-sm text-ink-2"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
            <DialogDescription className="text-ink-2">
              No exchange rate is available right now — enter one so this balance can show a
              converted total. It&rsquo;s used for display only, never for recording payments.
            </DialogDescription>
          </div>
          <Field
            label={`1 ${entry.currency} = ? ${viewerCurrency}`}
            error={localError ?? serverError}
            required
          >
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                placeholder="0.00"
                value={value}
                invalid={Boolean(localError ?? serverError)}
                disabled={createManualRate.isPending}
                onChange={(e) => {
                  setValue(e.target.value);
                  setTouched(true);
                }}
              />
            )}
          </Field>
        </DialogBody>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={createManualRate.isPending}
          >
            Not now
          </Button>
          <Button type="submit" loading={createManualRate.isPending} disabled={!locallyValid}>
            Save rate
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
