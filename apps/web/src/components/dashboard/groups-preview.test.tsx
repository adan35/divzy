import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupSummaryDto } from '@divzy/shared';

/**
 * WI-068 (AC-4a): the balance highlight now renders its money portion
 * through `<MoneyText>`, a nested `<span>` — RTL's default `getByText` won't
 * match text split across elements even when the parent's aggregated
 * `textContent` equals the target. Match on the row's full text instead.
 */
function textMatcher(expected: string) {
  return (_: string, element: Element | null) => {
    if (element?.textContent !== expected) return false;
    // Prefer the innermost element carrying this exact text — skip ancestors
    // that merely aggregate a single child's identical textContent.
    const onlyChild = element.children.length === 1 ? element.children[0] : null;
    return onlyChild?.textContent !== expected;
  };
}

/**
 * Build-stage TDD coverage for spec-WI-057: the dashboard "Your groups"
 * preview must (1) filter to groups where the viewer has a real outstanding
 * balance — keyed off `yourBalancesNative`, never the group-wide `settled`
 * flag — and (2) render/rank per-group highlights from the collapsed
 * converted+native entries, not the raw WI-001-narrowed `yourBalances` field.
 *
 * Mocking approach mirrors the Friends dashboard preview / Groups page tests:
 * `useGroups` and `next/navigation` are mocked; the real `GroupsPreview` /
 * `GroupRow` / `GroupNet` components render for real so highlight text and
 * navigation hrefs can be asserted directly.
 */

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const useGroupsMock = vi.fn();
vi.mock('@/lib/hooks', () => ({ useGroups: () => useGroupsMock() }));

import { GroupsPreview } from './groups-preview';

function fixtureGroup(overrides: Partial<GroupSummaryDto> = {}): GroupSummaryDto {
  return {
    id: 'group-1',
    name: 'Lisbon trip',
    emoji: '✈️',
    type: 'TRIP',
    currency: 'USD',
    memberCount: 3,
    yourBalances: [],
    yourBalancesNative: [],
    yourBalanceConverted: null,
    usedFallbackRates: false,
    lastActivityAt: '2026-07-01T00:00:00.000Z',
    archivedAt: null,
    settled: false,
    ...overrides,
  };
}

function mockGroups(data: GroupSummaryDto[]) {
  useGroupsMock.mockReturnValue({
    data,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
}

describe('GroupsPreview (spec-WI-057)', () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('filters to groups with a real outstanding viewer balance: Trip and Roommates shown, Book Club (zero) excluded', () => {
    mockGroups([
      fixtureGroup({
        id: 'trip',
        name: 'Trip',
        yourBalances: [{ currency: 'PKR', amount: -50000 }],
        yourBalancesNative: [{ currency: 'PKR', amount: -50000 }],
      }),
      fixtureGroup({
        id: 'roommates',
        name: 'Roommates',
        yourBalances: [],
        yourBalancesNative: [{ currency: 'USD', amount: 2000 }],
        yourBalanceConverted: { currency: 'USD', amount: 2000 },
      }),
      fixtureGroup({
        id: 'book-club',
        name: 'Book Club',
        yourBalances: [],
        yourBalancesNative: [],
        yourBalanceConverted: null,
      }),
    ]);

    render(<GroupsPreview />);

    expect(screen.getByText('Trip')).toBeInTheDocument();
    expect(screen.getByText('Roommates')).toBeInTheDocument();
    expect(screen.queryByText('Book Club')).not.toBeInTheDocument();
  });

  it('filters off the viewer balance, not the group-wide `settled` flag: viewer-zero group with settled:false (other members owe each other) is excluded', () => {
    mockGroups([
      fixtureGroup({
        id: 'shared-flat',
        name: 'Shared Flat',
        yourBalances: [],
        yourBalancesNative: [],
        yourBalanceConverted: null,
        settled: false,
      }),
      fixtureGroup({
        id: 'trip',
        name: 'Trip',
        yourBalances: [],
        yourBalancesNative: [{ currency: 'USD', amount: -2000 }],
        yourBalanceConverted: { currency: 'USD', amount: -2000 },
      }),
    ]);

    render(<GroupsPreview />);

    expect(screen.queryByText('Shared Flat')).not.toBeInTheDocument();
    expect(screen.getByText('Trip')).toBeInTheDocument();
  });

  it('highlight: single convertible currency renders "You owe <converted>", never "Settled up"', () => {
    mockGroups([
      fixtureGroup({
        id: 'trip',
        name: 'Trip',
        yourBalances: [],
        yourBalancesNative: [{ currency: 'USD', amount: -6530 }],
        yourBalanceConverted: { currency: 'USD', amount: -6530 },
      }),
    ]);

    render(<GroupsPreview />);

    expect(screen.getByText(textMatcher('You owe $65.30'))).toBeInTheDocument();
    expect(screen.queryByText('Settled up')).not.toBeInTheDocument();
  });

  it('leftover-currency regression: an unconvertible currency in yourBalances still renders its native line', () => {
    mockGroups([
      fixtureGroup({
        id: 'trip',
        name: 'Trip',
        yourBalances: [{ currency: 'JPY', amount: -500 }],
        yourBalancesNative: [{ currency: 'JPY', amount: -500 }],
        yourBalanceConverted: null,
      }),
    ]);

    render(<GroupsPreview />);

    expect(screen.getByText(textMatcher('You owe ¥500'))).toBeInTheDocument();
  });

  it('ranking: a large convertible balance ranks ahead of a small unconvertible leftover (two-arg balanceMagnitude)', () => {
    mockGroups([
      fixtureGroup({
        id: 'small-leftover',
        name: 'Small Leftover',
        yourBalances: [{ currency: 'JPY', amount: -100 }],
        yourBalancesNative: [{ currency: 'JPY', amount: -100 }],
        yourBalanceConverted: null,
        lastActivityAt: '2026-07-01T00:00:00.000Z',
      }),
      fixtureGroup({
        id: 'big-debt',
        name: 'Big Debt',
        yourBalances: [],
        yourBalancesNative: [{ currency: 'USD', amount: -900000 }],
        yourBalanceConverted: { currency: 'USD', amount: -900000 },
        lastActivityAt: '2026-06-01T00:00:00.000Z',
      }),
    ]);

    render(<GroupsPreview />);

    const rows = screen.getAllByRole('link').map((el) => el.textContent ?? '');
    const bigIdx = rows.findIndex((t) => t.includes('Big Debt'));
    const smallIdx = rows.findIndex((t) => t.includes('Small Leftover'));
    expect(bigIdx).toBeGreaterThanOrEqual(0);
    expect(smallIdx).toBeGreaterThanOrEqual(0);
    expect(bigIdx).toBeLessThan(smallIdx);
  });

  it('empty state: zero active groups shows the "No groups yet" onboarding state', () => {
    mockGroups([]);

    render(<GroupsPreview />);

    expect(screen.getByText('No groups yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new group/i })).toBeInTheDocument();
  });

  it('empty state: active groups exist but none outstanding shows a distinct "all settled up" state, not "No groups yet"', () => {
    mockGroups([
      fixtureGroup({
        id: 'book-club',
        name: 'Book Club',
        yourBalances: [],
        yourBalancesNative: [],
        yourBalanceConverted: null,
      }),
    ]);

    render(<GroupsPreview />);

    expect(screen.queryByText('No groups yet')).not.toBeInTheDocument();
    expect(screen.getByText(/all settled up/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new group/i })).not.toBeInTheDocument();
  });

  it('navigation regression: a row click still routes to /groups/:groupId, and no Settle Up trigger is added', async () => {
    mockGroups([
      fixtureGroup({
        id: 'trip-id',
        name: 'Trip',
        yourBalances: [],
        yourBalancesNative: [{ currency: 'USD', amount: -2000 }],
        yourBalanceConverted: { currency: 'USD', amount: -2000 },
      }),
    ]);

    render(<GroupsPreview />);

    expect(screen.getByRole('link', { name: /trip/i })).toHaveAttribute('href', '/groups/trip-id');
    expect(screen.queryByRole('button', { name: /settle up/i })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: /trip/i }));
  });
});
