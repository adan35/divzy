// WI-068 gap check — spec §9.1 explicitly names `SpendSnapshotChart` in the
// dashboard punch list ("`--chart-1` marks, active month emphasis, tooltip
// chrome §8.2") owned by slice S2 (`components/dashboard/` — ALL files, spec
// §10). Neither S2's build summary nor `git log` shows this file was ever
// edited for WI-068 (it still imports `formatMoney` directly and its
// `dashboard/page.tsx` swap note lists it among files "untouched" by the
// PulseHero change) — this test pins that gap as failing evidence rather
// than silently accepting it. See the WI-068 test-plan's per-AC table
// (AC-4a, AC-9b, AC-9c) for the write-up.
//
// Chart bar/gridline chrome itself is unassertable via RTL in this codebase
// (Recharts' ResponsiveContainer renders 0x0 under jsdom — see this file's
// own sibling `spend-snapshot-chart.wi036-snapshot.test.tsx` and the
// convention documented in `group-spend-chart.tsx`'s test), so the `--chart-1`
// / tooltip-chrome checks below are a source-text assertion, mirroring this
// same codebase's `wi068-no-raw-hex.test.ts` guard technique. The headline
// MoneyText adoption check IS renderable (a spy-mock on `@/components/ui/
// money-text`, mirroring `(app)/activity/page.wi068-chrome.test.tsx`'s
// pattern), since MoneyText's plain-mode output is otherwise textually
// identical to a bare `formatMoney()` span (no DOM difference to assert).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { AnalyticsSummaryDto } from '@divzy/shared';
import { SpendSnapshotChart } from './spend-snapshot-chart';
import { useAnalytics } from '@/lib/hooks';

vi.mock('@/lib/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks')>();
  return { ...actual, useAnalytics: vi.fn() };
});
vi.mock('@/components/ui/money-text', () => ({
  MoneyText: vi.fn(({ amount, currency }: { amount: number; currency: string }) => (
    <span data-testid="money-text-spy">{`${amount}:${currency}`}</span>
  )),
}));

const mockedUseAnalytics = vi.mocked(useAnalytics);

function fixtureSummary(overrides: Partial<AnalyticsSummaryDto> = {}): AnalyticsSummaryDto {
  return {
    currency: 'USD',
    from: '2026-05-01T00:00:00.000Z',
    to: '2026-07-16T12:00:00.000Z',
    yourSpend: 9000,
    totalActivity: 15000,
    previousYourSpend: 5000,
    byCategory: [],
    byMonth: [
      { month: '2026-05', amount: 2000, totalActivity: 4000 },
      { month: '2026-06', amount: 3000, totalActivity: 6000 },
      { month: '2026-07', amount: 4000, totalActivity: 5000 },
    ],
    byGroup: [],
    usedFallbackRates: false,
    ...overrides,
  };
}

describe('SpendSnapshotChart — WI-068 punch-list gap (spec §9.1/§8.2, AC-4a/AC-9b)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('EXPECTED (currently failing): the "This month" headline renders through <MoneyText>, not a bare formatMoney() span', () => {
    mockedUseAnalytics.mockReturnValue({
      isPending: false,
      isError: false,
      data: fixtureSummary(),
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAnalytics>);

    render(<SpendSnapshotChart />);

    expect(screen.getByText('This month')).toBeInTheDocument();
    expect(screen.queryByTestId('money-text-spy')).toBeInTheDocument();
  });

  it('EXPECTED (currently failing): single-series bar fill consumes --chart-1, never --brand (AC-9b)', () => {
    const source = readFileSync(path.join(__dirname, 'spend-snapshot-chart.tsx'), 'utf8');
    expect(source).not.toContain('var(--brand)');
    expect(source).toContain('var(--chart-1)');
  });

  it('EXPECTED (currently failing): tooltip chrome uses the §8.2 elevated/shadow-pop treatment, not the pre-WI-068 surface/shadow-sm', () => {
    const source = readFileSync(path.join(__dirname, 'spend-snapshot-chart.tsx'), 'utf8');
    expect(source).toContain('bg-elevated');
    expect(source).toContain('shadow-pop');
  });
});
