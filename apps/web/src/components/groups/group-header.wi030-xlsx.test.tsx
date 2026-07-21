import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import type { GroupDto } from '@divzy/shared';
import { GroupHeader } from './group-header';
import { api } from '@/lib/api';

// spec-WI-030 — "Export Excel" beside "Export CSV"/"Export PDF" in the group
// header dropdown, mirroring the ADR-014 PDF addition exactly.
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
      exportXlsx: vi.fn(),
      exportXlsxUrl: vi.fn(),
    },
  },
}));

const mockedExportXlsx = vi.mocked(api.groups.exportXlsx);

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

describe('GroupHeader — Export Excel entry point (spec-WI-030)', () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockedExportXlsx.mockReset();
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

  it('shows "Export Excel" beside "Export CSV" and "Export PDF" in the dropdown', async () => {
    await openDropdown();
    expect(screen.getByRole('menuitem', { name: /export csv/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /export pdf/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /export excel/i })).toBeInTheDocument();
  });

  it('clicking "Export Excel" calls api.groups.exportXlsx with the group id and downloads it under the correct filename', async () => {
    // exportXlsx resolves a Blob (binary), matching exportPdf's contract
    // post-defect-WI-018 — a plain string stub here would hide a regression
    // to a corrupting string-based signature.
    mockedExportXlsx.mockResolvedValue(
      new Blob(['xlsx-bytes'], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
    const user = await openDropdown();

    await user.click(screen.getByRole('menuitem', { name: /export excel/i }));

    await waitFor(() => expect(mockedExportXlsx).toHaveBeenCalledWith('group-1'));
    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURLSpy.mock.calls[0]?.[0];
    expect(blobArg).toBeInstanceOf(Blob);
    const anchor = clickSpy.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('roomies-expenses.xlsx');
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
    expect(toast.success).toHaveBeenCalledWith('Excel downloaded');
  });

  it('shows an error toast and does not download when the Excel export request fails', async () => {
    mockedExportXlsx.mockRejectedValue(new Error('boom'));
    const user = await openDropdown();

    await user.click(screen.getByRole('menuitem', { name: /export excel/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
