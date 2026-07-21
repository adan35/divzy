// Build-stage TDD coverage for spec-WI-016 Part B — the new `/settle` web
// route. This is the link target: it reads the query params the shareable
// link/QR encodes and renders the real `SettleUpDialog` open + pre-scoped,
// exactly the same shape mobile's existing `app/settle.tsx` already consumes
// (ADR-013). Mirrors `friends/[friendId]/wi001-prefill.test.tsx`'s approach —
// mock `SettleUpDialog` and capture its props rather than re-deriving the
// parsing logic by reading the source a second time.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let capturedProps: { open?: boolean; groupId?: string; prefill?: unknown } = {};
const pushMock = vi.fn();
let searchParamsValue = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsValue,
}));
vi.mock('@/components/settle/settle-dialog', () => ({
  SettleUpDialog: (props: { open: boolean; groupId?: string; prefill?: unknown }) => {
    capturedProps = props;
    return <div data-testid="settle-dialog-stub" />;
  },
}));

import SettlePage from './page';

describe('WB — /settle page (WI-016 Part B link target)', () => {
  beforeEach(() => {
    pushMock.mockClear();
    capturedProps = {};
  });

  it('parses fromUserId/toUserId/amount/currency/groupId and opens SettleUpDialog pre-scoped with exact values', () => {
    searchParamsValue = new URLSearchParams({
      fromUserId: 'user_ana',
      toUserId: 'user_bob',
      amount: '5000',
      currency: 'USD',
      groupId: 'group_ski',
    });

    render(<SettlePage />);

    expect(screen.getByTestId('settle-dialog-stub')).toBeInTheDocument();
    expect(capturedProps.open).toBe(true);
    expect(capturedProps.groupId).toBe('group_ski');
    expect(capturedProps.prefill).toEqual({
      fromUserId: 'user_ana',
      toUserId: 'user_bob',
      amount: 5000,
      currency: 'USD',
    });
  });

  it('omits groupId from the dialog props when the link has no groupId (non-group settle link)', () => {
    searchParamsValue = new URLSearchParams({
      fromUserId: 'user_ana',
      toUserId: 'user_bob',
      amount: '1250',
      currency: 'EUR',
    });
    capturedProps = {};

    render(<SettlePage />);

    expect(capturedProps.groupId).toBeUndefined();
    expect(capturedProps.prefill).toEqual({
      fromUserId: 'user_ana',
      toUserId: 'user_bob',
      amount: 1250,
      currency: 'EUR',
    });
  });

  it('missing/invalid amount leaves prefill undefined but still opens the dialog (no broken/blank state)', () => {
    searchParamsValue = new URLSearchParams({
      fromUserId: 'user_ana',
      toUserId: 'user_bob',
      currency: 'USD',
      amount: 'not-a-number',
    });
    capturedProps = {};

    render(<SettlePage />);

    expect(capturedProps.open).toBe(true);
    expect(capturedProps.prefill).toBeUndefined();
  });

  it('no query params at all still renders the dialog open with no prefill (bare /settle)', () => {
    searchParamsValue = new URLSearchParams();
    capturedProps = {};

    render(<SettlePage />);

    expect(capturedProps.open).toBe(true);
    expect(capturedProps.prefill).toBeUndefined();
    expect(capturedProps.groupId).toBeUndefined();
  });
});
