// Build-stage TDD coverage for spec-WI-068 §9.1 as applied to the Activity
// page: (1) AC-4a — the money figure inside an activity sentence must render
// through the shared MoneyText component, never a bare formatMoney() string
// (asserted by mocking '@/components/ui/money-text' as a spy: on the
// pre-WI-068 code this spy is never invoked at all, since the page used its
// own local `Money` span wrapping a plain formatted string); (2) §2 section
// labels — day separators (Today / Yesterday / date headings) use the
// section-label type scale (weight 600, +0.06em tracking), not the old
// font-medium/tracking-wide pairing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ActivityDto, UserDto } from '@divzy/shared';
import { useAuth } from '@/lib/auth-store';
import { useActivityInfinite } from '@/lib/hooks';
import ActivityPage from './page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/auth-store', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks')>();
  return { ...actual, useActivityInfinite: vi.fn() };
});
vi.mock('@/components/expenses/expense-detail', () => ({
  ExpenseDetailDialog: () => null,
}));
vi.mock('@/components/settle/settlement-detail', () => ({
  SettlementDetailDialog: () => null,
}));

const moneyTextSpy = vi.fn((_props: { amount: number; currency: string }) => null);
vi.mock('@/components/ui/money-text', () => ({
  MoneyText: (props: { amount: number; currency: string }) => moneyTextSpy(props),
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseActivityInfinite = vi.mocked(useActivityInfinite);

function me(overrides: Partial<UserDto> = {}): UserDto {
  return {
    id: 'me',
    name: 'Me',
    avatarColor: '#000',
    email: 'me@example.com',
    defaultCurrency: 'GBP',
    emailNotifications: true,
    staleBalanceRemindersEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function activityItem(overrides: Partial<ActivityDto> = {}): ActivityDto {
  return {
    id: 'act-1',
    type: 'EXPENSE_ADDED',
    actor: { id: 'friend-1', name: 'Sam', avatarColor: '#111' },
    group: null,
    expenseId: null,
    settlementId: null,
    data: { description: 'Groceries', amount: 4210, currency: 'GBP' },
    deletedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function activityQuery(items: ActivityDto[], overrides: Record<string, unknown> = {}) {
  return {
    data: { pages: [{ items, nextCursor: null }] },
    isPending: false,
    isError: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useActivityInfinite>;
}

describe('ActivityPage — WI-068 chrome', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the sentence money figure through the shared MoneyText component (AC-4a)', () => {
    mockedUseAuth.mockReturnValue({ user: me(), status: 'authed' });
    mockedUseActivityInfinite.mockReturnValue(activityQuery([activityItem()]));

    render(<ActivityPage />);

    expect(moneyTextSpy).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 4210, currency: 'GBP' }),
    );
  });

  it('a settlement sentence\'s money figure also goes through MoneyText', () => {
    mockedUseAuth.mockReturnValue({ user: me(), status: 'authed' });
    mockedUseActivityInfinite.mockReturnValue(
      activityQuery([
        activityItem({
          type: 'SETTLEMENT_ADDED',
          expenseId: null,
          settlementId: 'settle-1',
          data: { fromName: 'Sam', toName: 'Me', amount: 1200, currency: 'GBP' },
        }),
      ]),
    );

    render(<ActivityPage />);

    expect(moneyTextSpy).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1200, currency: 'GBP' }),
    );
  });

  it('day separators use the section-label type scale (font-semibold, +0.06em tracking)', () => {
    mockedUseAuth.mockReturnValue({ user: me(), status: 'authed' });
    mockedUseActivityInfinite.mockReturnValue(activityQuery([activityItem()]));

    render(<ActivityPage />);

    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.className).toContain('font-semibold');
    expect(heading.className).toContain('tracking-[0.06em]');
    expect(heading.className).not.toContain('font-medium');
    expect(heading.className).not.toContain('tracking-wide');
  });
});
