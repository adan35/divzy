import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import type { GroupDto } from '@divzy/shared';
import { GroupHeader } from './group-header';
import { api } from '@/lib/api';

// spec-WI-018 — "Export PDF" beside "Export CSV" in the group header dropdown.
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

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
    },
  },
}));

const mockedExportPdf = vi.mocked(api.groups.exportPdf);

// story-WI-003's Gherkin ACs, covering GroupHeader's placement/wiring contract
// directly (spec-WI-003 Decisions: "placed immediately before the existing
// 'Invite' button"; "rendered and enabled unconditionally... exactly matching
// this existing pattern" for archived groups).

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

describe('GroupHeader — Settle Up entry point (story-WI-003)', () => {
  it('shows "Settle Up" immediately before "Invite", visible on the default (Expenses) render', () => {
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
      />,
    );
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    const settleIdx = buttons.findIndex((t) => t?.includes('Settle Up'));
    const inviteIdx = buttons.findIndex((t) => t?.includes('Invite'));
    expect(settleIdx).toBeGreaterThanOrEqual(0);
    expect(inviteIdx).toBeGreaterThan(settleIdx);
  });

  it('opens the settle flow (calls onSettleUp) when clicked, independent of tab state', async () => {
    const onSettleUp = vi.fn();
    const user = userEvent.setup();
    render(
      <GroupHeader
        group={fixtureGroup()}
        isAdmin
        onSettleUp={onSettleUp}
        onInvite={noop}
        onEdit={noop}
        onArchive={noop}
        onLeave={noop}
        onDelete={noop}
      />,
    );
    await user.click(screen.getByRole('button', { name: /settle up/i }));
    expect(onSettleUp).toHaveBeenCalledTimes(1);
  });

  it('renders Settle Up on an archived group exactly as it renders Invite — no new gating', () => {
    render(
      <GroupHeader
        group={fixtureGroup({ archivedAt: '2026-06-01T00:00:00.000Z' })}
        isAdmin
        onSettleUp={noop}
        onInvite={noop}
        onEdit={noop}
        onArchive={noop}
        onLeave={noop}
        onDelete={noop}
      />,
    );
    const settleButton = screen.getByRole('button', { name: /settle up/i });
    const inviteButton = screen.getByRole('button', { name: /invite/i });
    expect(settleButton).toBeEnabled();
    expect(inviteButton).toBeEnabled();
  });
});

describe('GroupHeader — Export PDF entry point (spec-WI-018)', () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockedExportPdf.mockReset();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    createObjectURLSpy = vi.fn(() => 'blob:mock-url');
    revokeObjectURLSpy = vi.fn();
    URL.createObjectURL = createObjectURLSpy as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURLSpy as unknown as typeof URL.revokeObjectURL;
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  async function openDropdown() {
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
      />,
    );
    await user.click(screen.getByRole('button', { name: /group settings/i }));
    return user;
  }

  it('shows "Export PDF" beside "Export CSV" in the dropdown', async () => {
    await openDropdown();
    expect(screen.getByRole('menuitem', { name: /export csv/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /export pdf/i })).toBeInTheDocument();
  });

  it('clicking "Export PDF" calls api.groups.exportPdf with the group id and downloads it under the correct filename', async () => {
    // exportPdf resolves a Blob (binary), matching the real api-client
    // contract post-defect-WI-018 — a plain string stub here would hide a
    // regression to the old (corrupting) string-based signature.
    mockedExportPdf.mockResolvedValue(new Blob(['pdf-bytes'], { type: 'application/pdf' }));
    const user = await openDropdown();

    await user.click(screen.getByRole('menuitem', { name: /export pdf/i }));

    await waitFor(() => expect(mockedExportPdf).toHaveBeenCalledWith('group-1'));
    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURLSpy.mock.calls[0]?.[0];
    expect(blobArg).toBeInstanceOf(Blob);
    const anchor = clickSpy.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('roomies-expenses.pdf');
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
    expect(toast.success).toHaveBeenCalledWith('PDF downloaded');
  });

  it('shows an error toast and does not download when the PDF export request fails', async () => {
    mockedExportPdf.mockRejectedValue(new Error('boom'));
    const user = await openDropdown();

    await user.click(screen.getByRole('menuitem', { name: /export pdf/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
