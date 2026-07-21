// spec-WI-051 / story-WI-051 — back-to-groups-list button, head of
// GroupHeader's left cluster (D1), icon-only ArrowLeft with
// aria-label="Back to groups" (D2), unconditional router.push('/groups')
// (D3) — no `archived` branch, no `isAdmin` gate. Written directly from
// story-WI-051.md's Gherkin scenarios, modeled off the sibling
// group-header.wi046-delete.test.tsx file's fixture/openDropdown shape.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupDto } from '@divzy/shared';
import { GroupHeader } from './group-header';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api', () => ({
  api: {
    groups: {
      exportCsv: vi.fn(),
      exportPdf: vi.fn(),
      exportPdfUrl: vi.fn(),
      exportXlsx: vi.fn(),
      exportXlsxUrl: vi.fn(),
    },
  },
}));

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn() }),
}));

function fixtureGroup(overrides: Partial<GroupDto> = {}): GroupDto {
  return {
    id: 'group-1',
    name: 'Roomies',
    emoji: '🏠',
    type: 'HOME',
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

function noop() {
  /* not exercised in these assertions */
}

function renderHeader(props: Partial<Parameters<typeof GroupHeader>[0]> = {}) {
  return render(
    <GroupHeader
      group={fixtureGroup()}
      isAdmin
      onSettleUp={noop}
      onInvite={noop}
      onEdit={noop}
      onArchive={noop}
      onLeave={noop}
      onDelete={noop}
      {...props}
    />,
  );
}

describe('GroupHeader — back-to-groups-list button (story-WI-051)', () => {
  afterEach(() => {
    cleanup();
    pushMock.mockClear();
  });

  it('renders with the accessible label "Back to groups"', () => {
    renderHeader();
    expect(screen.getByRole('button', { name: 'Back to groups' })).toBeInTheDocument();
  });

  it('is the first button rendered in the header (head of the left cluster, before the emoji/name, not mixed with Settle Up / Invite / the settings dropdown)', () => {
    renderHeader();
    const buttons = screen.getAllByRole('button', { hidden: true });
    // First interactive control in document order must be the back button —
    // proves it precedes Settle Up/Invite/the MoreVertical trigger, all of
    // which live in the right cluster (D1).
    expect(buttons[0]).toHaveAccessibleName('Back to groups');
  });

  it('navigates to /groups via router.push when clicked', async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole('button', { name: 'Back to groups' }));

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('/groups');
  });

  it('uses router.push, not router.replace or window navigation, preserving history', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByRole('button', { name: 'Back to groups' }));
    // Only one call recorded across the whole click — no fallback/replace path.
    expect(pushMock.mock.calls).toEqual([['/groups']]);
  });

  it('is visible and functional on an archived group, independent of the archived state', async () => {
    const user = userEvent.setup();
    renderHeader({ group: fixtureGroup({ archivedAt: '2026-06-01T00:00:00.000Z' }) });

    const backButton = screen.getByRole('button', { name: 'Back to groups' });
    expect(backButton).toBeInTheDocument();
    expect(backButton).toBeEnabled();

    await user.click(backButton);
    expect(pushMock).toHaveBeenCalledWith('/groups');
  });

  it('renders identically for a non-admin member — not a role-gated action', () => {
    renderHeader({ isAdmin: false });
    const backButton = screen.getByRole('button', { name: 'Back to groups' });
    expect(backButton).toBeInTheDocument();
    expect(backButton).toBeEnabled();
  });

  it('renders the same back button markup for admin and non-admin (no conditional branch on isAdmin)', () => {
    const { container: adminContainer, unmount } = renderHeader({ isAdmin: true });
    const adminButtonHtml = screen.getByRole('button', { name: 'Back to groups' }).outerHTML;
    unmount();

    renderHeader({ isAdmin: false });
    const memberButtonHtml = screen.getByRole('button', { name: 'Back to groups' }).outerHTML;

    expect(memberButtonHtml).toBe(adminButtonHtml);
    void adminContainer;
  });

  it('remains visible regardless of group state permutations (archived + non-admin combined)', () => {
    renderHeader({
      isAdmin: false,
      group: fixtureGroup({ archivedAt: '2026-06-01T00:00:00.000Z' }),
    });
    expect(screen.getByRole('button', { name: 'Back to groups' })).toBeInTheDocument();
  });

  it('the icon inside the button is decorative (aria-hidden), leaving the button aria-label as the sole accessible name', () => {
    renderHeader();
    const backButton = screen.getByRole('button', { name: 'Back to groups' });
    const icon = backButton.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});
