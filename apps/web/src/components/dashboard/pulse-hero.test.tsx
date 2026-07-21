// WI-068 S2 (Web money moments) — spec §6 / story AC-6: Divzy Pulse hero.
// Replaces `BalanceStatCards` (retired — see stat-cards removal in this
// build's summary): one hero card with an animated net-position figure,
// owe/owed chips, a 6-month spend sparkline, a deterministic insight line,
// and a settle CTA. Mocking convention mirrors the retired
// stat-cards.test.tsx (useOverallBalance / useAnalytics / ManualRatePrompts)
// plus a mocked PulseSparkline/SettleUpDialog to assert prop wiring without
// re-testing their own already-covered internals.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnalyticsSummaryDto, OverallBalanceDto } from '@divzy/shared';
import { PulseHero } from './pulse-hero';
import { useAnalytics, useOverallBalance } from '@/lib/hooks';

vi.mock('@/lib/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks')>();
  return { ...actual, useOverallBalance: vi.fn(), useAnalytics: vi.fn() };
});
vi.mock('@/components/settle/manual-rate-prompt', () => ({
  ManualRatePrompts: vi.fn(({ unresolved, viewerCurrency }) => (
    <div data-testid="manual-rate-prompts" data-viewer={viewerCurrency}>
      {unresolved.map((u: { currency: string }) => u.currency).join(',')}
    </div>
  )),
}));

let capturedSparklineProps: Record<string, unknown> = {};
vi.mock('./pulse-sparkline', () => ({
  PulseSparkline: (props: Record<string, unknown>) => {
    capturedSparklineProps = props;
    return <div data-testid="pulse-sparkline" />;
  },
}));

let capturedDialogProps: Record<string, unknown> = {};
vi.mock('@/components/settle/settle-dialog', () => ({
  SettleUpDialog: (props: Record<string, unknown>) => {
    capturedDialogProps = props;
    return <div data-testid="settle-dialog" data-open={String(props.open)} />;
  },
}));

const mockedUseOverallBalance = vi.mocked(useOverallBalance);
const mockedUseAnalytics = vi.mocked(useAnalytics);

// Mirrors money-text.test.tsx's mockMatchMedia helper — the SAME real
// `usePrefersReducedMotion`/`prefersReducedMotion` (@/lib/motion) backs both
// PulseHero's own choreography gating AND MoneyText's internal count-up, so
// stubbing `matchMedia` (rather than mocking the module) keeps both in sync.
// Content-assertion tests default to reduced=true so the figure/aria text
// renders its final value with no rAF involved; a dedicated describe block
// below flips this to prove the animate/animateOnMount wiring under motion.
function mockMatchMedia(reduced: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? reduced : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
}

function balanceQuery(overrides: Partial<ReturnType<typeof useOverallBalance>> = {}) {
  return {
    isPending: false,
    isError: false,
    data: undefined,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useOverallBalance>;
}

function overallBalance(overrides: Partial<OverallBalanceDto> = {}): OverallBalanceDto {
  return {
    totals: [],
    youOwe: [],
    youAreOwed: [],
    converted: {
      currency: 'GBP',
      total: 0,
      youOwe: 0,
      youAreOwed: 0,
      unresolved: [],
      usedFallbackRates: false,
    },
    ...overrides,
  };
}

function analyticsQuery(overrides: Partial<ReturnType<typeof useAnalytics>> = {}) {
  return {
    isPending: false,
    isError: false,
    data: undefined,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useAnalytics>;
}

function analyticsSummary(overrides: Partial<AnalyticsSummaryDto> = {}): AnalyticsSummaryDto {
  return {
    currency: 'GBP',
    from: '2026-02-01T00:00:00.000Z',
    to: '2026-07-16T00:00:00.000Z',
    yourSpend: 9000,
    totalActivity: 15000,
    previousYourSpend: 5000,
    byCategory: [],
    byMonth: [
      { month: '2026-05', amount: 5000, totalActivity: 8000 },
      { month: '2026-06', amount: 4000, totalActivity: 7000 },
      { month: '2026-07', amount: 3000, totalActivity: 6000 },
    ],
    byGroup: [],
    usedFallbackRates: false,
    ...overrides,
  };
}

beforeEach(() => mockMatchMedia(true));
afterEach(() => vi.unstubAllGlobals());

describe('PulseHero — states (AC-6b/c)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('loading: renders a skeleton, no figure/insight/CTA content', () => {
    mockedUseOverallBalance.mockReturnValue(balanceQuery({ isPending: true }));
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ isPending: true }));

    render(<PulseHero />);

    expect(screen.queryByText(/overall/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /settle up/i })).not.toBeInTheDocument();
  });

  it('error: shows the retry-able error and refetches on retry', async () => {
    const refetch = vi.fn();
    mockedUseOverallBalance.mockReturnValue(
      balanceQuery({ isError: true, error: new Error('Balance blip'), refetch }),
    );
    mockedUseAnalytics.mockReturnValue(analyticsQuery());

    render(<PulseHero />);

    expect(screen.getByText('Balance blip')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('PulseHero — net position + insight + CTA (AC-6a)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the converted net figure, insight line, chips and a settle CTA when owed money', () => {
    mockedUseOverallBalance.mockReturnValue(
      balanceQuery({
        data: overallBalance({
          totals: [{ currency: 'GBP', amount: 128450 }],
          youAreOwed: [{ currency: 'GBP', amount: 137070 }],
          youOwe: [{ currency: 'GBP', amount: 8620 }],
          converted: {
            currency: 'GBP',
            total: 128450,
            youOwe: 8620,
            youAreOwed: 137070,
            unresolved: [],
            usedFallbackRates: false,
          },
        }),
      }),
    );
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ data: analyticsSummary() }));

    render(<PulseHero />);

    expect(screen.getByText('+£1,284.50')).toBeInTheDocument();
    expect(screen.getByText('owed to you')).toBeInTheDocument();
    expect(screen.getByText("You're owed £1,284.50 overall.")).toBeInTheDocument();
    expect(screen.getByText('£86.20')).toBeInTheDocument();
    expect(screen.getByText('£1,370.70')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /settle up/i })).toBeInTheDocument();
  });

  it('shows the "you owe" wording and keeps the settle CTA visible when net-negative (still outstanding)', () => {
    mockedUseOverallBalance.mockReturnValue(
      balanceQuery({
        data: overallBalance({
          totals: [{ currency: 'GBP', amount: -8620 }],
          youOwe: [{ currency: 'GBP', amount: 8620 }],
          converted: {
            currency: 'GBP',
            total: -8620,
            youOwe: 8620,
            youAreOwed: 0,
            unresolved: [],
            usedFallbackRates: false,
          },
        }),
      }),
    );
    mockedUseAnalytics.mockReturnValue(analyticsQuery());

    render(<PulseHero />);

    expect(screen.getByText('you owe')).toBeInTheDocument();
    expect(screen.getByText('You owe £86.20 overall.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /settle up/i })).toBeInTheDocument();
  });

  it('opens the SettleUpDialog when the settle CTA is clicked', async () => {
    mockedUseOverallBalance.mockReturnValue(
      balanceQuery({
        data: overallBalance({
          totals: [{ currency: 'GBP', amount: -8620 }],
          youOwe: [{ currency: 'GBP', amount: 8620 }],
          converted: {
            currency: 'GBP',
            total: -8620,
            youOwe: 8620,
            youAreOwed: 0,
            unresolved: [],
            usedFallbackRates: false,
          },
        }),
      }),
    );
    mockedUseAnalytics.mockReturnValue(analyticsQuery());

    render(<PulseHero />);

    expect(capturedDialogProps.open).toBe(false);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /settle up/i }));
    expect(screen.getByTestId('settle-dialog')).toHaveAttribute('data-open', 'true');
  });

  it('shows the fallback-rates notice when a contributing conversion used bundled fallback rates', () => {
    mockedUseOverallBalance.mockReturnValue(
      balanceQuery({
        data: overallBalance({
          totals: [{ currency: 'GBP', amount: 100 }],
          youAreOwed: [{ currency: 'GBP', amount: 100 }],
          converted: {
            currency: 'GBP',
            total: 100,
            youOwe: 0,
            youAreOwed: 100,
            unresolved: [],
            usedFallbackRates: true,
          },
        }),
      }),
    );
    mockedUseAnalytics.mockReturnValue(analyticsQuery());

    render(<PulseHero />);
    expect(screen.getByText('Converted with offline rates')).toBeInTheDocument();
  });

  it('passes byMonth/currency/reducedMotion through to PulseSparkline', () => {
    mockedUseOverallBalance.mockReturnValue(balanceQuery({ data: overallBalance() }));
    mockedUseAnalytics.mockReturnValue(analyticsQuery({ data: analyticsSummary() }));

    render(<PulseHero />);

    expect(capturedSparklineProps.byMonth).toEqual(analyticsSummary().byMonth);
    expect(capturedSparklineProps.currency).toBe('GBP');
    expect(capturedSparklineProps.reducedMotion).toBe(true);
  });
});

describe('PulseHero — reduced motion controls the choreography (AC-6f/AC-8)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('reduced motion (default for this file): the figure renders its FINAL value immediately, no in-flight animation', () => {
    mockedUseOverallBalance.mockReturnValue(
      balanceQuery({
        data: overallBalance({
          totals: [{ currency: 'GBP', amount: 128450 }],
          youAreOwed: [{ currency: 'GBP', amount: 128450 }],
          converted: {
            currency: 'GBP',
            total: 128450,
            youOwe: 0,
            youAreOwed: 128450,
            unresolved: [],
            usedFallbackRates: false,
          },
        }),
      }),
    );
    mockedUseAnalytics.mockReturnValue(analyticsQuery());

    render(<PulseHero />);

    // No "0.00" transient — reduced motion snaps straight to the target.
    expect(screen.getByText('+£1,284.50')).toBeInTheDocument();
    expect(capturedSparklineProps.reducedMotion).toBe(true);
  });

  it('without reduced motion, animateOnMount is actually wired: the figure starts at zero with the final value only in aria-label', () => {
    mockMatchMedia(false);
    mockedUseOverallBalance.mockReturnValue(
      balanceQuery({
        data: overallBalance({
          totals: [{ currency: 'GBP', amount: 128450 }],
          youAreOwed: [{ currency: 'GBP', amount: 128450 }],
          converted: {
            currency: 'GBP',
            total: 128450,
            youOwe: 0,
            youAreOwed: 128450,
            unresolved: [],
            usedFallbackRates: false,
          },
        }),
      }),
    );
    mockedUseAnalytics.mockReturnValue(analyticsQuery());

    render(<PulseHero />);

    // animateOnMount counts up from 0 — the first render is the start value,
    // with the accessible label already carrying the final formatted value
    // (spec §3/AC-4c). This proves PulseHero wires `animate animateOnMount`,
    // not just that MoneyText supports it (already covered by
    // money-text.test.tsx).
    // The FINAL amount is positive, so signed-color's "+" prefix already
    // applies even to the in-flight (zero) displayed value.
    expect(screen.getByText('+£0.00')).toBeInTheDocument();
    expect(screen.getByText('+£0.00').getAttribute('aria-label')).toBe('+£1,284.50');
    expect(capturedSparklineProps.reducedMotion).toBe(false);
  });
});

describe('PulseHero — settled vs. unresolved-only (AC-6e, WI-001 guard)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('settled: native totals/youOwe/youAreOwed all empty renders "All settled" and hides the CTA', () => {
    mockedUseOverallBalance.mockReturnValue(balanceQuery({ data: overallBalance() }));
    mockedUseAnalytics.mockReturnValue(analyticsQuery());

    render(<PulseHero />);

    expect(screen.getByText('All settled')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /settle up/i })).not.toBeInTheDocument();
  });

  it('unresolved-only: converted.total is 0 but native currencies are unresolved — never reads settled, CTA still shows, unresolved block renders', () => {
    mockedUseOverallBalance.mockReturnValue(
      balanceQuery({
        data: overallBalance({
          totals: [{ currency: 'XYZ', amount: 1200 }],
          youAreOwed: [{ currency: 'XYZ', amount: 1200 }],
          converted: {
            currency: 'GBP',
            total: 0,
            youOwe: 0,
            youAreOwed: 0,
            unresolved: [{ currency: 'XYZ', amount: 1200 }],
            usedFallbackRates: false,
          },
        }),
      }),
    );
    mockedUseAnalytics.mockReturnValue(analyticsQuery());

    render(<PulseHero />);

    expect(screen.queryByText('All settled')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /settle up/i })).toBeInTheDocument();
    const prompt = screen.getByTestId('manual-rate-prompts');
    expect(prompt).toHaveAttribute('data-viewer', 'GBP');
    expect(prompt).toHaveTextContent('XYZ');
    expect(screen.getByText(/unconverted/i)).toBeInTheDocument();
  });
});
