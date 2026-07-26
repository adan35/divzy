// spec-WI-087 — GroupWhiteboard component behavior.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import type { GroupWhiteboardDto } from '@divzy/shared';
import { GroupWhiteboard } from './group-whiteboard';
import { useGroupWhiteboard, useUpdateGroupWhiteboard } from '@/lib/hooks';

const NOTICE =
  "Visible to all members of this group — please don't store passwords or other sensitive information here.";

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/hooks', () => ({
  useGroupWhiteboard: vi.fn(),
  useUpdateGroupWhiteboard: vi.fn(),
  errorMessage: (error: unknown) =>
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : 'Something went wrong',
}));

const mockedUseGroupWhiteboard = vi.mocked(useGroupWhiteboard);
const mockedUseUpdateGroupWhiteboard = vi.mocked(useUpdateGroupWhiteboard);

function fixtureWhiteboard(overrides: Partial<GroupWhiteboardDto> = {}): GroupWhiteboardDto {
  return {
    body: 'Meet at 9am',
    updatedBy: { id: 'user-1', name: 'Ana', avatarColor: '#123456' },
    updatedAt: '2026-07-26T10:00:00.000Z',
    ...overrides,
  };
}

describe('GroupWhiteboard (spec-WI-087)', () => {
  const mutate = vi.fn();

  beforeEach(() => {
    // @ts-expect-error -- test setup only
    mockedUseUpdateGroupWhiteboard.mockReturnValue({ mutate, isPending: false });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the sensitive-info notice and the no-revision-history notice', () => {
    // @ts-expect-error -- test setup only
    mockedUseGroupWhiteboard.mockReturnValue({
      data: fixtureWhiteboard(),
      isLoading: false,
      isError: false,
      isSuccess: true,
    });

    render(<GroupWhiteboard groupId="group-1" />);

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.getByText(/No revision history is kept/i)).toBeInTheDocument();
  });

  it('shows last-edited attribution when available', () => {
    // @ts-expect-error -- test setup only
    mockedUseGroupWhiteboard.mockReturnValue({
      data: fixtureWhiteboard(),
      isLoading: false,
      isError: false,
      isSuccess: true,
    });

    render(<GroupWhiteboard groupId="group-1" />);

    expect(screen.getByText(/Last edited by Ana/i)).toBeInTheDocument();
  });

  it('shows "No edits yet" when the whiteboard has never been edited', () => {
    // @ts-expect-error -- test setup only
    mockedUseGroupWhiteboard.mockReturnValue({
      data: fixtureWhiteboard({ updatedBy: null, updatedAt: null }),
      isLoading: false,
      isError: false,
      isSuccess: true,
    });

    render(<GroupWhiteboard groupId="group-1" />);

    expect(screen.getByText('No edits yet')).toBeInTheDocument();
  });

  it('initializes the textarea from the fetched body', () => {
    // @ts-expect-error -- test setup only
    mockedUseGroupWhiteboard.mockReturnValue({
      data: fixtureWhiteboard(),
      isLoading: false,
      isError: false,
      isSuccess: true,
    });

    render(<GroupWhiteboard groupId="group-1" />);

    expect(screen.getByRole('textbox', { name: /Group whiteboard/i })).toHaveValue('Meet at 9am');
  });

  it('disables Save when the draft is unchanged', () => {
    // @ts-expect-error -- test setup only
    mockedUseGroupWhiteboard.mockReturnValue({
      data: fixtureWhiteboard(),
      isLoading: false,
      isError: false,
      isSuccess: true,
    });

    render(<GroupWhiteboard groupId="group-1" />);

    expect(screen.getByRole('button', { name: /Save/i })).toBeDisabled();
  });

  it('enables Save after the user changes the draft and calls the mutation with the new body', async () => {
    const user = userEvent.setup();
    // @ts-expect-error -- test setup only
    mockedUseGroupWhiteboard.mockReturnValue({
      data: fixtureWhiteboard(),
      isLoading: false,
      isError: false,
      isSuccess: true,
    });

    render(<GroupWhiteboard groupId="group-1" />);

    const textarea = screen.getByRole('textbox', { name: /Group whiteboard/i });
    await user.clear(textarea);
    await user.type(textarea, 'New meeting point');

    const saveButton = screen.getByRole('button', { name: /Save/i });
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);
    expect(mutate).toHaveBeenCalledWith({ groupId: 'group-1', body: 'New meeting point' });
  });

  it('updates the character counter as the user types', async () => {
    const user = userEvent.setup();
    // @ts-expect-error -- test setup only
    mockedUseGroupWhiteboard.mockReturnValue({
      data: fixtureWhiteboard({ body: '' }),
      isLoading: false,
      isError: false,
      isSuccess: true,
    });

    render(<GroupWhiteboard groupId="group-1" />);

    const textarea = screen.getByRole('textbox', { name: /Group whiteboard/i });
    await user.type(textarea, 'hello');

    expect(screen.getByText('5/2000 characters')).toBeInTheDocument();
  });
});
