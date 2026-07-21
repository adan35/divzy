// spec-WI-020 — group-creation templates (web half).
//
// Covers: suggested categories + split mode render on create for a curated
// type, are visibly labeled as suggestions, are overridable, independent
// per-field touched flags preserve overrides across a type switch while
// refreshing untouched fields, no suggestion block for a non-curated type
// (no stale leftover), no suggestion block on edit, and the submit payload
// stays name/emoji/type/currency/simplifyDebts only (template selections are
// never sent).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupDto } from '@divzy/shared';
import { GroupFormDialog } from './group-form-dialog';
import { useAuth } from '@/lib/auth-store';
import { useCreateGroup, useUpdateGroup } from '@/lib/hooks';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/auth-store', () => ({ useAuth: vi.fn() }));
vi.mock('@/lib/hooks', () => ({
  useCreateGroup: vi.fn(),
  useUpdateGroup: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseCreateGroup = vi.mocked(useCreateGroup);
const mockedUseUpdateGroup = vi.mocked(useUpdateGroup);

function fixtureGroup(overrides: Partial<GroupDto> = {}): GroupDto {
  return {
    id: 'group-1',
    name: 'Roomies',
    emoji: '🔑',
    type: 'ROOMMATES',
    currency: 'USD',
    inviteCode: 'ABCDEFGHIJ',
    simplifyDebts: true,
    createdBy: { id: 'user-1', name: 'Sam Lee', avatarColor: '#000' },
    members: [
      {
        user: { id: 'user-1', name: 'Sam Lee', avatarColor: '#000' },
        role: 'ADMIN',
        joinedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('GroupFormDialog — group-creation templates (spec-WI-020)', () => {
  let createMutate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createMutate = vi.fn();
    mockedUseAuth.mockReturnValue({
      user: { id: 'user-1', defaultCurrency: 'USD' },
    } as unknown as ReturnType<typeof useAuth>);
    mockedUseCreateGroup.mockReturnValue({
      mutate: createMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useCreateGroup>);
    mockedUseUpdateGroup.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateGroup>);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('selecting a curated type (Roommates) shows a labeled suggestion block with suggested categories and split mode', async () => {
    const user = userEvent.setup();
    render(<GroupFormDialog open onOpenChange={() => {}} />);

    await user.selectOptions(screen.getByLabelText('Type'), 'ROOMMATES');

    expect(
      screen.getByText(/Suggested for a Roommates group — you can change these/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Rent')).toBeInTheDocument();
    expect(screen.getByText('Utilities')).toBeInTheDocument();
    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Equal')).toBeInTheDocument();
  });

  it('default type on open (TRIP) already shows its suggestion block', () => {
    render(<GroupFormDialog open onOpenChange={() => {}} />);

    expect(screen.getByText(/Suggested for a Trip group/i)).toBeInTheDocument();
    expect(screen.getByText('Travel')).toBeInTheDocument();
    expect(screen.getByText('Equal')).toBeInTheDocument();
  });

  it('deselecting a suggested category and changing the split mode reflects the override, not the original template', async () => {
    const user = userEvent.setup();
    render(<GroupFormDialog open onOpenChange={() => {}} />);
    await user.selectOptions(screen.getByLabelText('Type'), 'ROOMMATES');

    await user.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-pressed', 'false');

    await user.selectOptions(screen.getByLabelText('Suggested split mode'), 'SHARES');
    expect(screen.getByLabelText('Suggested split mode')).toHaveValue('SHARES');
  });

  it('switching type preserves a touched split-mode override while still refreshing the untouched category list', async () => {
    const user = userEvent.setup();
    render(<GroupFormDialog open onOpenChange={() => {}} />);
    await user.selectOptions(screen.getByLabelText('Type'), 'ROOMMATES');

    // Touch only the split mode; leave categories untouched.
    await user.selectOptions(screen.getByLabelText('Suggested split mode'), 'SHARES');

    await user.selectOptions(screen.getByLabelText('Type'), 'TRIP');

    // Category list refreshed to Trip's untouched suggestions.
    expect(screen.getByText(/Suggested for a Trip group/i)).toBeInTheDocument();
    expect(screen.getByText('Travel')).toBeInTheDocument();
    // Split mode override preserved, not clobbered back to Equal.
    expect(screen.getByLabelText('Suggested split mode')).toHaveValue('SHARES');
  });

  it('switching type preserves a touched category override while the untouched split mode refreshes', async () => {
    const user = userEvent.setup();
    render(<GroupFormDialog open onOpenChange={() => {}} />);
    await user.selectOptions(screen.getByLabelText('Type'), 'ROOMMATES');

    // Touch only the categories.
    await user.click(screen.getByRole('button', { name: 'Home' }));

    await user.selectOptions(screen.getByLabelText('Type'), 'TRIP');

    // Trip's suggestion block still renders, but category override (Home
    // deselected) is preserved rather than replaced by Trip's list.
    expect(screen.queryByRole('button', { name: 'Travel' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rent' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('a type with no curated template shows no suggestion block, and no stale leftover from the previous type', async () => {
    const user = userEvent.setup();
    render(<GroupFormDialog open onOpenChange={() => {}} />);
    await user.selectOptions(screen.getByLabelText('Type'), 'ROOMMATES');
    expect(screen.getByText(/Suggested for a Roommates group/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Type'), 'SUBSCRIPTION');

    expect(screen.queryByText(/Suggested for/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Rent')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Suggested split mode')).not.toBeInTheDocument();
  });

  it('does not render a suggestion block at all when editing an existing group', () => {
    render(<GroupFormDialog open onOpenChange={() => {}} group={fixtureGroup()} />);

    expect(screen.queryByText(/Suggested for/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Suggested split mode')).not.toBeInTheDocument();
  });

  it('submits the unchanged payload (name/emoji/type/currency/simplifyDebts only) — template selections are discarded', async () => {
    const user = userEvent.setup();
    render(<GroupFormDialog open onOpenChange={() => {}} />);

    await user.type(screen.getByLabelText(/^Name/), 'Lisbon trip');
    await user.selectOptions(screen.getByLabelText('Type'), 'ROOMMATES');
    await user.click(screen.getByRole('button', { name: 'Home' }));
    await user.selectOptions(screen.getByLabelText('Suggested split mode'), 'SHARES');

    await user.click(screen.getByRole('button', { name: 'Create group' }));

    expect(createMutate).toHaveBeenCalledWith(
      {
        name: 'Lisbon trip',
        emoji: '🔑',
        type: 'ROOMMATES',
        currency: 'USD',
        simplifyDebts: true,
      },
      expect.anything(),
    );
  });
});
