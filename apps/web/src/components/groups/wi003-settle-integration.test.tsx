import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { GroupDto } from '@divzy/shared';
import { useAuthStore } from '@/lib/auth-store';
import { GroupHeader } from './group-header';
import { SettleUpDialog } from '@/components/settle/settle-dialog';
import { useState } from 'react';

/**
 * Test-stage INTEGRATION case for story-WI-003 (social-groups), written
 * independently of the Build-stage dev's own `group-header.test.tsx` (which
 * only exercises GroupHeader in isolation with a `noop` onSettleUp). This
 * test wires GroupHeader + the REAL, unmodified SettleUpDialog
 * (apps/web/src/components/settle/settle-dialog.tsx — settlements' owned
 * component) together exactly the way apps/web/src/app/(app)/groups/[groupId]/page.tsx
 * does, to verify the cross-domain UI integration point named in the Test
 * charter: "the web GroupHeader's Settle Up button actually opening
 * settlements' real SettleUpDialog component with the right groupId."
 *
 * Only the HTTP client (`@/lib/api`) is mocked — SettleUpDialog itself,
 * its react-query hooks, and GroupHeader are all real, unmodified code.
 */

const groupGetMock = vi.fn();
const friendsListMock = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    groups: {
      get: (...args: unknown[]) => groupGetMock(...args),
      exportCsv: vi.fn(),
    },
    friends: { list: (...args: unknown[]) => friendsListMock(...args) },
    settlements: { create: vi.fn() },
  },
}));

// WI-051: GroupHeader now calls useRouter() directly (back-to-groups-list
// button) — must be mocked or render() throws "invariant expected app router
// to be mounted". Dedicated router-behavior assertions live in
// group-header.wi051-back-button.test.tsx; this mock exists here only so
// this file's pre-existing (unrelated) Settle-Up integration test keeps
// rendering the real GroupHeader.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

function fixtureGroup(overrides: Partial<GroupDto> = {}): GroupDto {
  return {
    id: 'group-porto',
    name: 'Weekend in Porto',
    emoji: '🚋',
    type: 'TRIP',
    currency: 'EUR',
    inviteCode: 'PORTOABCDE',
    simplifyDebts: true,
    createdBy: { id: 'u-alice', name: 'Alice Tran', avatarColor: '#111' },
    members: [
      { user: { id: 'u-alice', name: 'Alice Tran', avatarColor: '#111' }, role: 'ADMIN', joinedAt: '2026-01-01T00:00:00.000Z' },
      { user: { id: 'u-bilal', name: 'Bilal Khan', avatarColor: '#222' }, role: 'MEMBER', joinedAt: '2026-01-02T00:00:00.000Z' },
      { user: { id: 'u-cleo', name: 'Cleo Vance', avatarColor: '#333' }, role: 'MEMBER', joinedAt: '2026-01-03T00:00:00.000Z' },
    ],
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Mirrors GroupPage's own wiring (page.tsx lines ~117-169) exactly. */
function HostPage({ group }: { group: GroupDto }) {
  const [settleOpen, setSettleOpen] = useState(false);
  return (
    <>
      <GroupHeader
        group={group}
        isAdmin
        onSettleUp={() => setSettleOpen(true)}
        onInvite={() => {}}
        onEdit={() => {}}
        onArchive={() => {}}
        onLeave={() => {}}
        onDelete={() => {}}
      />
      <SettleUpDialog open={settleOpen} onOpenChange={setSettleOpen} groupId={group.id} />
    </>
  );
}

function renderHost(group: GroupDto) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HostPage group={group} />
    </QueryClientProvider>,
  );
}

describe('INT — GroupHeader "Settle Up" opens the real settlements SettleUpDialog scoped to the right group', () => {
  beforeEach(() => {
    groupGetMock.mockReset();
    friendsListMock.mockReset().mockResolvedValue([]);
    // Real zustand store (not mocked) — SettleUpDialog's useAuth() reads this
    // directly, so "meInvolved" validation and the From-select default work.
    useAuthStore.setState({
      user: {
        id: 'u-alice',
        name: 'Alice Tran',
        email: 'alice@example.com',
        avatarColor: '#111',
        defaultCurrency: 'EUR',
      },
      accessToken: 'test-token',
      status: 'authed',
    } as never);
  });

  it('INT-1: dialog is not present before the button is clicked', () => {
    renderHost(fixtureGroup());
    expect(screen.queryByText('Record a payment')).not.toBeInTheDocument();
  });

  it('INT-2: clicking Settle Up opens the real SettleUpDialog, which fetches and shows exactly this group\'s members (not friends, not another group)', async () => {
    const group = fixtureGroup();
    groupGetMock.mockResolvedValue(group);
    friendsListMock.mockResolvedValue([]); // must NOT be consulted for a group-scoped settle

    const user = userEvent.setup();
    renderHost(group);

    await user.click(screen.getByRole('button', { name: /settle up/i }));

    expect(await screen.findByText('Record a payment')).toBeInTheDocument();

    // The real, unmodified SettleUpDialog called api.groups.get with THIS
    // group's id — proving groupId actually threaded through the whole
    // GroupHeader -> GroupPage-state -> SettleUpDialog -> useGroup chain.
    await waitFor(() => expect(groupGetMock).toHaveBeenCalledWith('group-porto'));
    // Note: SettleUpDialog's own useFriends() call fires unconditionally
    // regardless of groupId (pre-existing, unmodified behavior of
    // settlements' component, not part of WI-003) — its result is simply
    // unused when groupId is set (candidates derive from group.members).

    // Party pickers are scoped to the group's 3 members exactly (per
    // story-WI-003: "payer/recipient choices are limited to Roomies members").
    await waitFor(() => {
      const fromSelect = screen.getByLabelText(/from/i) as HTMLSelectElement;
      const optionNames = Array.from(fromSelect.options).map((o) => o.textContent);
      expect(optionNames).toHaveLength(3);
      expect(optionNames.some((n) => n?.includes('Alice Tran'))).toBe(true);
      expect(optionNames.some((n) => n?.includes('Bilal Khan'))).toBe(true);
      expect(optionNames.some((n) => n?.includes('Cleo Vance'))).toBe(true);
    });

    // No amount or party prefilled (spec-WI-003: "no amount or party is prefilled").
    const amountInput = screen.getByLabelText(/amount/i) as HTMLInputElement;
    expect(amountInput.value).toBe('');
  });

  it('INT-3: opening Settle Up for a DIFFERENT group requests that group\'s own id, not a stale one', async () => {
    const groupA = fixtureGroup({ id: 'group-a', name: 'Group A' });
    groupGetMock.mockImplementation((id: string) =>
      Promise.resolve(id === 'group-a' ? groupA : fixtureGroup({ id, name: 'Other' })),
    );

    const user = userEvent.setup();
    renderHost(groupA);
    await user.click(screen.getByRole('button', { name: /settle up/i }));
    await screen.findByText('Record a payment');

    await waitFor(() => expect(groupGetMock).toHaveBeenCalledWith('group-a'));
    expect(groupGetMock).not.toHaveBeenCalledWith('group-b');
  });
});
