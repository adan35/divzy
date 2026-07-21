import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NotificationDto } from '@divzy/shared';
import { useClearNotification, useMarkNotificationRead } from '@/lib/hooks';
import { NotificationRow } from './notification-row';

// spec-WI-056 §4: a per-row "clear" action, distinct from the existing
// click-to-mark-read row action — must not conflict with or accidentally
// trigger it.

vi.mock('@/lib/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks')>();
  return {
    ...actual,
    useMarkNotificationRead: vi.fn(),
    useClearNotification: vi.fn(),
  };
});

const mockedUseMarkNotificationRead = vi.mocked(useMarkNotificationRead);
const mockedUseClearNotification = vi.mocked(useClearNotification);

function notification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: 'notif-1',
    type: 'EXPENSE_ADDED',
    title: 'New expense',
    body: 'Sam added Groceries',
    data: {},
    readAt: null,
    clearedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function mutationStub(mutate = vi.fn()) {
  return { mutate, isPending: false } as unknown as ReturnType<typeof useMarkNotificationRead>;
}

describe('NotificationRow (WI-056 clear action)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('clicking the row still marks an unread notification as read (regression)', async () => {
    const markReadMutate = vi.fn();
    mockedUseMarkNotificationRead.mockReturnValue(mutationStub(markReadMutate));
    mockedUseClearNotification.mockReturnValue(mutationStub());
    render(<NotificationRow notification={notification()} />);

    await userEvent.click(screen.getByText('New expense'));
    expect(markReadMutate).toHaveBeenCalledWith('notif-1');
  });

  it('clicking the clear button calls the clear mutation and does not mark read', async () => {
    const markReadMutate = vi.fn();
    const clearMutate = vi.fn();
    mockedUseMarkNotificationRead.mockReturnValue(mutationStub(markReadMutate));
    mockedUseClearNotification.mockReturnValue(mutationStub(clearMutate));
    render(<NotificationRow notification={notification()} />);

    await userEvent.click(screen.getByRole('button', { name: /clear/i }));

    expect(clearMutate).toHaveBeenCalledWith('notif-1');
    expect(markReadMutate).not.toHaveBeenCalled();
  });

  it('clear is available on an already-read notification too', async () => {
    const clearMutate = vi.fn();
    mockedUseMarkNotificationRead.mockReturnValue(mutationStub());
    mockedUseClearNotification.mockReturnValue(mutationStub(clearMutate));
    render(<NotificationRow notification={notification({ readAt: '2026-07-01T00:00:00.000Z' })} />);

    await userEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(clearMutate).toHaveBeenCalledWith('notif-1');
  });
});
