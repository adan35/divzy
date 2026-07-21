'use client';

import { useState } from 'react';
import { CheckCircle2, Sparkles } from 'lucide-react';
import { startOfMonth, subMonths } from 'date-fns';
import { useMemo } from 'react';
import { useAnalytics, useOverallBalance } from '@/lib/hooks';
import { usePrefersReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FallbackRatesNotice } from '@/components/ui/fallback-rates-notice';
import { MoneyText } from '@/components/ui/money-text';
import { Skeleton } from '@/components/ui/skeleton';
import { ManualRatePrompts } from '@/components/settle/manual-rate-prompt';
import { SettleUpDialog } from '@/components/settle/settle-dialog';
import { pulseInsight } from './pulse-insight';
import { PulseSparkline } from './pulse-sparkline';
import { SectionError } from './section-error';

/** Reserved so the loading/error/loaded states never shift layout (CLS < 0.1, spec §6 states). */
const HERO_MIN_HEIGHT = 'min-h-[236px]';

function SettledRing({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
      <svg viewBox="0 0 40 40" className="absolute inset-0 h-10 w-10" aria-hidden="true">
        <circle
          cx={20}
          cy={20}
          r={17}
          pathLength={1}
          fill="none"
          strokeWidth={2}
          className={cn('stroke-pos', !reducedMotion && 'animate-[pulse-settle-ring_650ms_ease-out_forwards]')}
          style={{
            strokeDasharray: 1,
            strokeDashoffset: reducedMotion ? 0 : 1,
          }}
        />
      </svg>
      <CheckCircle2 className="h-6 w-6 text-pos" aria-hidden="true" />
      {/* One-time ring draw — scoped keyframes (this component owns no globals.css edit, S1-owned). */}
      <style>{`@keyframes pulse-settle-ring { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }`}</style>
    </span>
  );
}

/**
 * Divzy Pulse — the dashboard hero (spec §6 / story AC-6). Replaces the old
 * 3-card `BalanceStatCards` grid: one hero card with an animated net-position
 * figure, owe/owed chips, a 6-month spend-trend sparkline (existing
 * `useAnalytics` byMonth — no new endpoint, no client-side conversion), a
 * deterministic insight line (`pulseInsight`), and a settle CTA. The
 * `FallbackRatesNotice`, unresolved-currencies block and `ManualRatePrompts`
 * below are the same WI-001/WI-002 affordances the old component rendered,
 * unchanged in behavior.
 */
export function PulseHero() {
  const balance = useOverallBalance();
  const range = useMemo(() => {
    const now = new Date();
    return { from: startOfMonth(subMonths(now, 5)).toISOString(), to: now.toISOString() };
  }, []);
  const analytics = useAnalytics(range);
  const reducedMotion = usePrefersReducedMotion();
  const [settleOpen, setSettleOpen] = useState(false);

  if (balance.isPending) {
    return (
      <Card className={cn(HERO_MIN_HEIGHT, 'space-y-4 p-6')} aria-hidden="true">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-[100px] w-full" />
      </Card>
    );
  }

  if (balance.isError) {
    return (
      <Card className={cn(HERO_MIN_HEIGHT, 'flex items-center justify-center p-6')}>
        <SectionError error={balance.error} onRetry={() => void balance.refetch()} />
      </Card>
    );
  }

  const { totals, youOwe, youAreOwed, converted } = balance.data;
  const settled = totals.length === 0 && youOwe.length === 0 && youAreOwed.length === 0;
  const hasUnresolved = converted.unresolved.length > 0;
  const showSettleCta = !settled && (converted.total !== 0 || hasUnresolved);

  const byMonth = analytics.data?.byMonth ?? [];
  const insight = pulseInsight({ totals, youOwe, youAreOwed, converted }, byMonth);
  const sparklineCurrency = analytics.data?.currency ?? converted.currency;

  return (
    <div className="space-y-3">
      {converted.usedFallbackRates && <FallbackRatesNotice />}

      <Card className={cn(HERO_MIN_HEIGHT, 'overflow-hidden p-6')}>
        <div className="flex h-full flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-ink-3">
              Net position
            </p>

            {settled ? (
              <div className="mt-3 flex items-center gap-3">
                <SettledRing reducedMotion={reducedMotion} />
                <span className="text-2xl font-bold tracking-tight text-ink">All settled</span>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <MoneyText
                  amount={converted.total}
                  currency={converted.currency}
                  mode="signed-color"
                  animate
                  animateOnMount
                  className="text-[36px] font-bold leading-none tracking-[-0.02em]"
                />
                <span className="text-sm text-ink-3">
                  {converted.total > 0 ? 'owed to you' : converted.total < 0 ? 'you owe' : ''}
                </span>
              </div>
            )}

            <p className="mt-3 flex items-start gap-1.5 text-sm text-ink-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              <span className={cn(!reducedMotion && 'animate-fade-in')}>
                {insight.base}
                {insight.spend && (
                  <>
                    {' '}
                    <span className={insight.spend.tone === 'pos' ? 'text-pos' : 'text-ink-2'}>
                      {insight.spend.text}
                    </span>
                  </>
                )}
                {insight.unresolved && <> {insight.unresolved}</>}
              </span>
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {converted.youOwe !== 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-neg-soft px-2.5 py-1 text-[13px] font-medium text-neg">
                  You owe <MoneyText amount={converted.youOwe} currency={converted.currency} />
                </span>
              )}
              {converted.youAreOwed !== 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-pos-soft px-2.5 py-1 text-[13px] font-medium text-pos">
                  You&rsquo;re owed{' '}
                  <MoneyText amount={converted.youAreOwed} currency={converted.currency} />
                </span>
              )}
              {showSettleCta && (
                <Button size="sm" className="ml-auto" onClick={() => setSettleOpen(true)}>
                  Settle up
                </Button>
              )}
            </div>
          </div>

          <div className="w-full shrink-0 lg:w-[38%]">
            {analytics.isPending ? (
              <Skeleton className="h-[100px] w-full" />
            ) : analytics.isError ? (
              <div className="flex h-[100px] items-center justify-center text-xs text-ink-3">
                Spend trend unavailable
              </div>
            ) : (
              <PulseSparkline
                byMonth={byMonth}
                currency={sparklineCurrency}
                reducedMotion={reducedMotion}
              />
            )}
          </div>
        </div>
      </Card>

      {hasUnresolved && (
        <Card className="space-y-1.5 p-4">
          <p className="text-[13px] font-medium text-ink-2">Not yet converted</p>
          {converted.unresolved.map((entry) => (
            <p key={entry.currency} className="text-sm text-ink-2">
              <MoneyText amount={entry.amount} currency={entry.currency} />{' '}
              <span className="text-ink-3">unconverted</span>
            </p>
          ))}
        </Card>
      )}

      <ManualRatePrompts
        unresolved={converted.unresolved}
        viewerCurrency={converted.currency}
        onResolved={() => void balance.refetch()}
      />
      <SettleUpDialog open={settleOpen} onOpenChange={setSettleOpen} />
    </div>
  );
}
