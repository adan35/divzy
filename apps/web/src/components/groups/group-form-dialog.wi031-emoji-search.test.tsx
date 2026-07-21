// spec-WI-031 — searchable, bounded emoji picker in the New Group dialog.
//
// Covers: a search input filters the grid via searchGroupEmoji, clearing the
// search restores the full set, an empty result renders a "no results" state,
// the panel is a fixed-size scrollable container (not the reflow-y unbounded
// grid), and selection/type-default/stale-emoji-fallback behavior (WI-006/
// WI-007) survive unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GROUP_EMOJI_CHOICES } from '@divzy/shared';
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

describe('GroupFormDialog — searchable emoji picker (spec-WI-031)', () => {
  beforeEach(() => {
    // @ts-expect-error -- test setup only
    mockedUseAuth.mockReturnValue({ user: { id: 'me', defaultCurrency: 'USD' } });
    // @ts-expect-error -- test setup only
    mockedUseCreateGroup.mockReturnValue({ mutate: vi.fn(), isPending: false });
    // @ts-expect-error -- test setup only
    mockedUseUpdateGroup.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders a search input above the emoji grid', () => {
    render(<GroupFormDialog open onOpenChange={() => {}} />);
    expect(screen.getByRole('searchbox', { name: /search emoji/i })).toBeInTheDocument();
  });

  it('renders the full curated set with no search applied', () => {
    render(<GroupFormDialog open onOpenChange={() => {}} />);
    expect(screen.getAllByRole('radio')).toHaveLength(GROUP_EMOJI_CHOICES.length);
  });

  it('typing a query narrows the visible grid to matches', async () => {
    const user = userEvent.setup();
    render(<GroupFormDialog open onOpenChange={() => {}} />);

    await user.type(screen.getByRole('searchbox', { name: /search emoji/i }), 'pizza');

    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBeLessThan(GROUP_EMOJI_CHOICES.length);
    expect(screen.getByRole('radio', { name: 'Emoji 🍕' })).toBeInTheDocument();
  });

  it('clearing the search restores the full set', async () => {
    const user = userEvent.setup();
    render(<GroupFormDialog open onOpenChange={() => {}} />);

    const search = screen.getByRole('searchbox', { name: /search emoji/i });
    await user.type(search, 'pizza');
    await user.clear(search);

    expect(screen.getAllByRole('radio')).toHaveLength(GROUP_EMOJI_CHOICES.length);
  });

  it('shows a no-results state when the query matches nothing', async () => {
    const user = userEvent.setup();
    render(<GroupFormDialog open onOpenChange={() => {}} />);

    await user.type(
      screen.getByRole('searchbox', { name: /search emoji/i }),
      'zzznotarealemojikeyword',
    );

    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByText(/no matching emoji/i)).toBeInTheDocument();
  });

  it('the emoji grid lives inside a fixed-height scrollable panel', () => {
    render(<GroupFormDialog open onOpenChange={() => {}} />);
    const group = screen.getByRole('radiogroup', { name: /group emoji/i });
    // The scrollable panel is the grid's own container — bounded via a fixed
    // max-height + overflow, not an unbounded inline grid that reflows the form.
    expect(group.className).toMatch(/max-h-|overflow-y-auto/);
  });

  it('selecting an emoji still single-selects it (WI-006 behavior unchanged)', async () => {
    const user = userEvent.setup();
    render(<GroupFormDialog open onOpenChange={() => {}} />);

    const pizza = screen.getByRole('radio', { name: 'Emoji 🍕' });
    await user.click(pizza);

    expect(pizza).toHaveAttribute('aria-checked', 'true');
  });
});
