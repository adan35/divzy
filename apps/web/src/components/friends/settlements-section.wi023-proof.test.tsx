// Build-stage TDD coverage for spec-WI-023 (payment-proof attachment on a
// settlement) — the web view affordance on `SettlementsSection`'s row.
// Spec-WI-023 §2/§5: no new detail screen, just an inline thumbnail (image)
// or labeled link (PDF) on the existing row, gated on `proofUrl` truthiness,
// mirroring `ExpenseDetailDialog`'s receipt block exactly.
//
// `proofUrl` on `SettlementDto`/`CreateSettlementInput` was landed by a
// concurrent backend build during this build session (see build-WI-023.md /
// build-WI-023-web.md) — the fixture below uses the field directly.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { PublicUserDto, SettlementDto, UserDto } from '@divzy/shared';
import { SettlementsSection } from './settlements-section';
import { useAuth } from '@/lib/auth-store';
import { useDeleteSettlement, useSettlementsInfinite } from '@/lib/hooks';

vi.mock('@/lib/auth-store', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/hooks', () => ({
  errorMessage: (error: unknown) => String(error),
  useSettlementsInfinite: vi.fn(),
  useDeleteSettlement: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseSettlementsInfinite = vi.mocked(useSettlementsInfinite);
const mockedUseDeleteSettlement = vi.mocked(useDeleteSettlement);

const me: PublicUserDto = { id: 'me', name: 'Me', avatarColor: '#111111' };
const sam: PublicUserDto = { id: 'sam', name: 'Sam', avatarColor: '#222222' };

function meAuth(): UserDto {
  return {
    ...me,
    email: 'me@example.com',
    defaultCurrency: 'USD',
    emailNotifications: true,
    staleBalanceRemindersEnabled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function fixtureSettlement(overrides: Partial<SettlementDto> = {}): SettlementDto {
  return {
    id: 'settle-1',
    groupId: null,
    group: null,
    from: sam,
    to: me,
    amount: 500,
    currency: 'USD',
    method: 'CASH',
    note: null,
    date: '2026-07-01T00:00:00.000Z',
    createdBy: sam,
    deletedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    proofUrl: null,
    ...overrides,
  };
}

function settlementsQuery(items: ReturnType<typeof fixtureSettlement>[]) {
  return {
    data: { pages: [{ items, nextCursor: null }] },
    isPending: false,
    isError: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useSettlementsInfinite>;
}

describe('SettlementsSection — WI-023 payment-proof view affordance', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows no proof affordance when proofUrl is absent (no attachment = no display change)', () => {
    mockedUseAuth.mockReturnValue({ user: meAuth(), status: 'authed' });
    mockedUseSettlementsInfinite.mockReturnValue(
      settlementsQuery([fixtureSettlement({ proofUrl: null })]),
    );
    mockedUseDeleteSettlement.mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<
      typeof useDeleteSettlement
    >);

    render(<SettlementsSection friendId="sam" />);

    expect(screen.queryByRole('link', { name: /proof/i })).not.toBeInTheDocument();
  });

  it('shows an inline image thumbnail linking to the proof when proofUrl is an image', () => {
    mockedUseAuth.mockReturnValue({ user: meAuth(), status: 'authed' });
    mockedUseSettlementsInfinite.mockReturnValue(
      settlementsQuery([
        fixtureSettlement({ proofUrl: '/uploads/receipts/proof-1.jpg' }),
      ]),
    );
    mockedUseDeleteSettlement.mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<
      typeof useDeleteSettlement
    >);

    render(<SettlementsSection friendId="sam" />);

    // The link's accessible name folds in the thumbnail's alt text ("Payment
    // proof") alongside the visible "Proof" label, so match loosely and
    // assert on content/attributes instead of an exact accessible name.
    const link = screen.getByRole('link', { name: /proof/i });
    expect(link).toHaveAttribute('href', 'http://localhost:4000/uploads/receipts/proof-1.jpg');
    expect(link).not.toHaveTextContent(/pdf/i);
    expect(link.querySelector('img')).toHaveAttribute(
      'src',
      'http://localhost:4000/uploads/receipts/proof-1.jpg',
    );
  });

  it('shows a labeled PDF link (not an image) when proofUrl is a PDF', () => {
    mockedUseAuth.mockReturnValue({ user: meAuth(), status: 'authed' });
    mockedUseSettlementsInfinite.mockReturnValue(
      settlementsQuery([
        fixtureSettlement({ proofUrl: '/uploads/receipts/proof-2.pdf' }),
      ]),
    );
    mockedUseDeleteSettlement.mockReturnValue({ mutate: vi.fn(), isPending: false } as unknown as ReturnType<
      typeof useDeleteSettlement
    >);

    render(<SettlementsSection friendId="sam" />);

    const link = screen.getByRole('link', { name: /proof \(pdf\)/i });
    expect(link).toHaveAttribute('href', 'http://localhost:4000/uploads/receipts/proof-2.pdf');
    expect(link.querySelector('img')).not.toBeInTheDocument();
  });
});
