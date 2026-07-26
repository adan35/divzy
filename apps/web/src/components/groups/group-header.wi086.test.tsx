import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { GroupDto } from '@divzy/shared';
import { GroupHeader } from './group-header';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

function fixtureGroup(): GroupDto {
  return {
    id: 'g1',
    name: 'Trip',
    emoji: '✈️',
    type: 'TRIP',
    currency: 'GBP',
    inviteCode: 'ABCDEFGHIJ',
    simplifyDebts: true,
    createdBy: { id: 'me', name: 'Me', avatarColor: '#000' },
    members: [{ user: { id: 'me', name: 'Me', avatarColor: '#000' }, role: 'ADMIN', joinedAt: '2026-01-01T00:00:00.000Z' }],
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('GroupHeader — WI-086 Settle Up button attention color', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the Settle Up button without the owing treatment by default', () => {
    render(
      <GroupHeader
        group={fixtureGroup()}
        isAdmin
        onSettleUp={vi.fn()}
        onInvite={vi.fn()}
        onEdit={vi.fn()}
        onArchive={vi.fn()}
        onLeave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const button = screen.getByRole('button', { name: 'Settle Up' });
    expect(button).not.toHaveAttribute('data-owe');
    expect(button.className).not.toMatch(/warn/);
  });

  it('applies the amber warn treatment when iOwe is true', () => {
    render(
      <GroupHeader
        group={fixtureGroup()}
        isAdmin
        iOwe
        onSettleUp={vi.fn()}
        onInvite={vi.fn()}
        onEdit={vi.fn()}
        onArchive={vi.fn()}
        onLeave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const button = screen.getByRole('button', { name: 'Settle Up' });
    expect(button).toHaveAttribute('data-owe', 'true');
    expect(button.className).toMatch(/warn/);
  });
});
