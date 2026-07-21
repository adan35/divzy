// spec-WI-046 — "Delete group" entry point in the settings dropdown, mirroring
// the existing admin-gated "Archive group" pattern. Destructive styling
// (`danger`), admin-gated in the UI (server `assertAdmin` is authoritative
// regardless), wired to `onDelete`. Available whether or not the group is
// currently archived (delete and archive are independent flags).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupDto } from '@divzy/shared';
import { GroupHeader } from './group-header';
import { api } from '@/lib/api';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// WI-051: GroupHeader now calls useRouter() directly (back-to-groups-list
// button) — must be mocked or render() throws "invariant expected app router
// to be mounted". Dedicated router-behavior assertions live in
// group-header.wi051-back-button.test.tsx; this mock exists here only so
// this file's pre-existing (unrelated) tests keep rendering.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));
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
void api;

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
      { user: { id: 'user-1', name: 'Sam Lee', avatarColor: '#000' }, role: 'ADMIN', joinedAt: '2026-01-01T00:00:00.000Z' },
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

async function openDropdown(props: Partial<Parameters<typeof GroupHeader>[0]> = {}) {
  const user = userEvent.setup();
  render(
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
  await user.click(screen.getByRole('button', { name: /group settings/i }));
  return user;
}

describe('GroupHeader — Delete group entry point (spec-WI-046)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a destructive "Delete group" item to an admin and calls onDelete when selected', async () => {
    const onDelete = vi.fn();
    const user = await openDropdown({ onDelete });

    const item = screen.getByRole('menuitem', { name: /delete group/i });
    expect(item).toBeInTheDocument();
    expect(item.className).toContain('text-danger');

    await user.click(item);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('hides "Delete group" from a non-admin member', async () => {
    await openDropdown({ isAdmin: false });
    expect(screen.queryByRole('menuitem', { name: /delete group/i })).not.toBeInTheDocument();
  });

  it('shows "Delete group" to an admin even when the group is already archived', async () => {
    await openDropdown({ group: fixtureGroup({ archivedAt: '2026-06-01T00:00:00.000Z' }) });
    expect(screen.getByRole('menuitem', { name: /delete group/i })).toBeInTheDocument();
  });
});
