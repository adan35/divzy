import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { EXPENSE_CATEGORIES, type ExpenseDto, type PublicUserDto } from '@divzy/shared';
import { useAuth } from '@/lib/auth-store';
import {
  useCreateExpense,
  useFriends,
  useGroup,
  useGroups,
  useUpdateExpense,
  useUploadReceipt,
  useUsedCategories,
} from '@/lib/hooks';
import { ExpenseEditorDialog } from './expense-editor';

vi.mock('@/lib/auth-store', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/lib/hooks', () => ({
  errorMessage: (error: unknown) => String(error),
  useCreateExpense: vi.fn(),
  useUpdateExpense: vi.fn(),
  useFriends: vi.fn(),
  useGroup: vi.fn(),
  useGroups: vi.fn(),
  useUploadReceipt: vi.fn(),
  useUsedCategories: vi.fn(),
}));

const mePublic: PublicUserDto = { id: 'me', name: 'Me', avatarColor: '#111111' };
const ana: PublicUserDto = { id: 'ana', name: 'Ana', avatarColor: '#222222' };

function makeGroupExpense(overrides: Partial<ExpenseDto> = {}): ExpenseDto {
  return {
    id: 'exp-1',
    groupId: 'group-1',
    group: { id: 'group-1', name: 'Roommates', emoji: '🏠', currency: 'PKR' },
    description: 'Dinner',
    amount: 1600,
    currency: 'PKR',
    category: 'GIFTS',
    date: '2026-07-01T00:00:00.000Z',
    splitType: 'EQUAL',
    notes: null,
    receiptUrl: null,
    payers: [{ user: mePublic, amount: 1600 }],
    splits: [
      { user: mePublic, amount: 800, shares: null, percentBps: null, adjustment: null },
      { user: ana, amount: 800, shares: null, percentBps: null, adjustment: null },
    ],
    items: [],
    createdBy: mePublic,
    updatedBy: null,
    commentCount: 0,
    deletedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function setupCommonMocks() {
  (useAuth as unknown as Mock).mockReturnValue({
    user: {
      ...mePublic,
      email: 'me@example.com',
      defaultCurrency: 'PKR',
      emailNotifications: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    status: 'authed',
  });
  (useGroups as unknown as Mock).mockReturnValue({ data: [], isLoading: false, error: null });
  (useFriends as unknown as Mock).mockReturnValue({ data: [], isLoading: false, error: null });
  (useCreateExpense as unknown as Mock).mockReturnValue({ mutate: vi.fn(), isPending: false });
  (useUpdateExpense as unknown as Mock).mockReturnValue({ mutate: vi.fn(), isPending: false });
  (useUploadReceipt as unknown as Mock).mockReturnValue({ mutate: vi.fn(), isPending: false });
}

function mockUsedCategories(overrides: Partial<{
  data: { categories: string[] } | undefined;
  isLoading: boolean;
  isError: boolean;
}>) {
  (useUsedCategories as unknown as Mock).mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    ...overrides,
  });
}

function renderEditingExpense(expense: ExpenseDto, groupOverrides: Partial<{
  data: { members: { user: PublicUserDto }[] } | undefined;
}> = {}) {
  (useGroup as unknown as Mock).mockReturnValue({
    data: {
      id: expense.groupId,
      name: expense.group?.name ?? '',
      emoji: expense.group?.emoji ?? '',
      currency: expense.currency,
      members: [{ user: mePublic }, { user: ana }],
      ...groupOverrides.data,
    },
    isLoading: false,
    error: null,
  });

  return render(
    <ExpenseEditorDialog open onOpenChange={() => {}} expense={expense} />,
  );
}

describe('ExpenseEditorDialog — category picker narrowing (WI-032, group expenses)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupCommonMocks();
  });

  it('scenario: narrowed default shows only used categories + the escape hatch, current value always included', () => {
    mockUsedCategories({ data: { categories: ['FOOD_DRINK', 'HOME'] } });
    // Expense being edited currently has GIFTS, which is not in the used set.
    renderEditingExpense(makeGroupExpense({ category: 'GIFTS' }));

    const select = screen.getByLabelText('Category') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(['FOOD_DRINK', 'HOME', 'GIFTS']);
    expect(select.value).toBe('GIFTS');
    expect(screen.getByRole('button', { name: /more categories/i })).toBeInTheDocument();
  });

  it('scenario: activating "More categories" reveals all 16 in canonical order, any selectable', () => {
    mockUsedCategories({ data: { categories: ['FOOD_DRINK', 'HOME'] } });
    renderEditingExpense(makeGroupExpense({ category: 'FOOD_DRINK' }));

    fireEvent.click(screen.getByRole('button', { name: /more categories/i }));

    const select = screen.getByLabelText('Category') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(EXPENSE_CATEGORIES.map((c) => c.key));

    fireEvent.change(select, { target: { value: 'ENTERTAINMENT' } });
    expect(select.value).toBe('ENTERTAINMENT');
  });

  it('scenario: empty used-categories set renders the full 16-category list, no escape hatch needed', () => {
    mockUsedCategories({ data: { categories: [] } });
    renderEditingExpense(makeGroupExpense({ category: 'GENERAL' }));

    const select = screen.getByLabelText('Category') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(EXPENSE_CATEGORIES.map((c) => c.key));
    expect(screen.queryByRole('button', { name: /more categories/i })).not.toBeInTheDocument();
  });

  it('scenario: loading state falls back to the full list, not an empty/near-empty view', () => {
    mockUsedCategories({ isLoading: true, data: undefined });
    renderEditingExpense(makeGroupExpense({ category: 'GENERAL' }));

    const select = screen.getByLabelText('Category') as HTMLSelectElement;
    expect(select.options.length).toBe(EXPENSE_CATEGORIES.length);
  });

  it('scenario: error state falls back to the full list', () => {
    mockUsedCategories({ isError: true, data: undefined });
    renderEditingExpense(makeGroupExpense({ category: 'GENERAL' }));

    const select = screen.getByLabelText('Category') as HTMLSelectElement;
    expect(select.options.length).toBe(EXPENSE_CATEGORIES.length);
  });

  it('scenario: editing an expense whose category has since fallen out of "used" still shows/keeps it selected without escaping', () => {
    mockUsedCategories({ data: { categories: ['FOOD_DRINK'] } });
    renderEditingExpense(makeGroupExpense({ category: 'GIFTS' }));

    const select = screen.getByLabelText('Category') as HTMLSelectElement;
    expect(select.value).toBe('GIFTS');
    expect(Array.from(select.options).map((o) => o.value)).toContain('GIFTS');
  });

  it('scenario: non-group (direct) expense picker is unchanged — full list, no escape hatch, useUsedCategories not enabled', () => {
    mockUsedCategories({ data: undefined });
    const expense = makeGroupExpense({ groupId: null, group: null, category: 'GENERAL' });
    (useGroup as unknown as Mock).mockReturnValue({ data: undefined, isLoading: false, error: null });
    (useFriends as unknown as Mock).mockReturnValue({
      data: [{ user: ana }],
      isLoading: false,
      error: null,
    });

    render(<ExpenseEditorDialog open onOpenChange={() => {}} expense={expense} />);

    const select = screen.getByLabelText('Category') as HTMLSelectElement;
    expect(select.options.length).toBe(EXPENSE_CATEGORIES.length);
    expect(screen.queryByRole('button', { name: /more categories/i })).not.toBeInTheDocument();
    expect(useUsedCategories).toHaveBeenCalledWith({ groupId: undefined });
  });
});

describe('ExpenseEditorDialog — type-ahead group/friend picker (WI-042)', () => {
  const groups = [
    { id: 'g1', name: 'Roommates', emoji: '🏠', type: 'HOME', currency: 'PKR', memberCount: 2, yourBalances: [], yourBalancesNative: [], archivedAt: null },
    { id: 'g2', name: 'Lahore Trip', emoji: '✈️', type: 'TRIP', currency: 'PKR', memberCount: 3, yourBalances: [], yourBalancesNative: [], archivedAt: null },
    { id: 'g3', name: 'Book Club', emoji: '📚', type: 'OTHER', currency: 'PKR', memberCount: 4, yourBalances: [], yourBalancesNative: [], archivedAt: null },
  ];
  const ana: PublicUserDto = { id: 'ana', name: 'Ana', avatarColor: '#222222' };
  const anas: PublicUserDto = { id: 'anas', name: 'Anas', avatarColor: '#333333' };
  const bilal: PublicUserDto = { id: 'bilal', name: 'Bilal', avatarColor: '#444444' };
  const friends = [
    { user: ana, balances: [] },
    { user: anas, balances: [] },
    { user: bilal, balances: [] },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    setupCommonMocks();
    mockUsedCategories({ data: { categories: [] } });
    (useGroups as unknown as Mock).mockReturnValue({ data: groups, isLoading: false, error: null });
    (useFriends as unknown as Mock).mockReturnValue({ data: friends, isLoading: false, error: null });
    (useGroup as unknown as Mock).mockReturnValue({ data: undefined, isLoading: false, error: null });
  });

  function renderPicker() {
    return render(<ExpenseEditorDialog open onOpenChange={() => {}} />);
  }

  it('scenario: typing filters the group list live, case-insensitive substring match', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /choose a group/i }));

    const groupListbox = screen.getByRole('listbox', { name: 'Choose a group' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search groups' }), { target: { value: 'trip' } });
    let options = within(groupListbox).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Lahore Trip');

    fireEvent.change(screen.getByRole('textbox', { name: 'Search groups' }), { target: { value: 'TRIP' } });
    options = within(groupListbox).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Lahore Trip');
  });

  it('scenario: friend mode filters friends the same way; toggling back to group re-filters against groups, not stale friend results', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('radio', { name: 'Friend' }));
    fireEvent.click(screen.getByRole('button', { name: /choose a friend/i }));

    const friendListbox = screen.getByRole('listbox', { name: 'Choose a friend' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search friends' }), { target: { value: 'ana' } });
    const options = within(friendListbox).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Ana'), expect.stringContaining('Anas')]),
    );
    expect(options.some((o) => o.textContent?.includes('Bilal'))).toBe(false);

    // Toggle back to Group mode — the picker must re-filter against groups,
    // not show stale friend-mode results (D5: remounts fresh on toggle).
    fireEvent.click(screen.getByRole('radio', { name: 'Group' }));
    fireEvent.click(screen.getByRole('button', { name: /choose a group/i }));
    expect(
      within(screen.getByRole('listbox', { name: 'Choose a group' })).getAllByRole('option'),
    ).toHaveLength(groups.length);
  });

  it('scenario: no matches shows an explicit "no results" state, not a blank list', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /choose a group/i }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Search groups' }), { target: { value: 'zzzzz' } });

    expect(screen.getByText('No groups found')).toBeInTheDocument();
  });

  it('scenario: selecting a filtered result sets the group context exactly as the unfiltered list would', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /choose a group/i }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search groups' }), { target: { value: 'trip' } });

    fireEvent.click(screen.getByText('Lahore Trip'));

    expect(screen.getByRole('button', { name: /Lahore Trip/i })).toBeInTheDocument();
    expect(useGroup).toHaveBeenCalledWith('g2', true);
  });

  it('scenario: clearing the search restores the full, unfiltered list in the same order as today', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /choose a group/i }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search groups' }), { target: { value: 'trip' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search groups' }), { target: { value: '' } });

    const options = within(screen.getByRole('listbox', { name: 'Choose a group' })).getAllByRole(
      'option',
    );
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Roommates'),
      expect.stringContaining('Lahore Trip'),
      expect.stringContaining('Book Club'),
    ]);
  });
});
