import { describe, expect, it } from 'vitest';
import type { FriendDto } from '@divzy/shared';
import { friendSettleIntent, type SettleActor } from './settle-prefill';

/**
 * Build-stage TDD coverage for spec-WI-050 §2/§7: `friendSettleIntent` is the
 * friend-detail page's prefill/gate logic (page.tsx:110-147), extracted
 * verbatim so it can be reused by the dashboard Friends-row opener without
 * duplicating it. These cases mirror the four branches the spec's DoD lists:
 * owe-me, owe-friend, ambiguous fallback, nothing-outstanding — plus the
 * WB-2-style "converted figure but no native leftover" ambiguous case and a
 * missing-actor edge case, matching the pre-existing white-box coverage for
 * the page these branches were extracted from (wi001-prefill.test.tsx,
 * wi010-prefill.test.tsx, wi012-balance-gate.test.tsx).
 *
 * spec-WI-050 (REOPENED, 2026-07-18): the shipped helper read `friend.balances`
 * (WI-001-narrowed to unconvertible leftovers, `[]` in the common case) to
 * decide direction, silently falling back to the hardcoded `from=me,to=friend`
 * branch whenever that narrowed list was empty. Direction/amount must instead
 * be sourced from `friend.balancesNative` (the full native per-currency
 * breakdown). These cases now deliberately set `balances: []` (the narrowed
 * field, empty in the common case) alongside a populated `balancesNative` to
 * prove the fix reads the right field, not merely that it doesn't crash.
 */

function fixtureFriend(overrides: Partial<FriendDto> = {}): FriendDto {
  return {
    user: { id: 'sam', name: 'Sam Lee', avatarColor: '#000' },
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
    lastActivityAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

const me: SettleActor = { id: 'me', defaultCurrency: 'GBP' };

describe('friendSettleIntent', () => {
  it('single positive native balance (friend owes me) -> From = friend, To = me, disabled = false', () => {
    // balances (narrowed) is empty — the common post-WI-001 case — while
    // balancesNative carries the real signed figure. This is the exact WI-050
    // regression: the shipped helper fell back to from=me/to=friend here.
    // balancesConverted is non-zero because the single native currency is
    // (per the DTO invariant) convertible — that's exactly why `balances`
    // (narrowed) is empty here; the disable gate (untouched by this fix)
    // reads that converted figure as its "anything outstanding" boolean.
    const friend = fixtureFriend({
      balances: [],
      balancesNative: [{ currency: 'JPY', amount: 30000 }],
      balancesConverted: { currency: 'GBP', amount: 235 },
    });

    expect(friendSettleIntent(friend, me)).toEqual({
      disabled: false,
      prefill: { fromUserId: 'sam', toUserId: 'me', amount: 30000, currency: 'JPY' },
    });
  });

  it('single negative native balance (I owe friend) -> direction reversed', () => {
    const friend = fixtureFriend({
      balances: [],
      balancesNative: [{ currency: 'JPY', amount: -50000 }],
      balancesConverted: { currency: 'GBP', amount: -391 },
    });

    expect(friendSettleIntent(friend, me)).toEqual({
      disabled: false,
      prefill: { fromUserId: 'me', toUserId: 'sam', amount: 50000, currency: 'JPY' },
    });
  });

  it('PKR regression from spec-WI-050 §9: friend owes viewer PKR 800 with balances:[] -> from=friend,to=me,amount:80000,currency:PKR', () => {
    const friend = fixtureFriend({
      balances: [],
      balancesNative: [{ currency: 'PKR', amount: 80000 }],
      balancesConverted: { currency: 'GBP', amount: 220 },
    });

    expect(friendSettleIntent(friend, me)).toEqual({
      disabled: false,
      prefill: { fromUserId: 'sam', toUserId: 'me', amount: 80000, currency: 'PKR' },
    });
  });

  it('USD regression from spec-WI-050 §9: viewer owes friend USD 40 -> from=me,to=friend,amount:4000', () => {
    const friend = fixtureFriend({
      user: { id: 'sam-usd', name: 'Sam USD', avatarColor: '#000' },
      balances: [],
      balancesNative: [{ currency: 'USD', amount: -4000 }],
      balancesConverted: { currency: 'GBP', amount: -3163 },
    });

    expect(friendSettleIntent(friend, me)).toEqual({
      disabled: false,
      prefill: { fromUserId: 'me', toUserId: 'sam-usd', amount: 4000, currency: 'USD' },
    });
  });

  it('ambiguous non-zero balance (two non-zero NATIVE, unconvertible currencies) -> amount:0 fallback in me.defaultCurrency', () => {
    // Both currencies are unconvertible here, so `balances` (narrowed) holds
    // both leftovers too — realistic per the DTO invariant, and sufficient on
    // its own to keep the disable gate's `nothingOutstanding` false.
    const friend = fixtureFriend({
      balances: [
        { currency: 'JPY', amount: -50000 },
        { currency: 'USD', amount: 4000 },
      ],
      balancesNative: [
        { currency: 'JPY', amount: -50000 },
        { currency: 'USD', amount: 4000 },
      ],
    });

    expect(friendSettleIntent(friend, me)).toEqual({
      disabled: false,
      prefill: { fromUserId: 'me', toUserId: 'sam', amount: 0, currency: 'GBP' },
    });
  });

  it('narrowed `balances` populated but `balancesNative` empty/ambiguous still falls back — proves direction is NOT sourced from `balances`', () => {
    const friend = fixtureFriend({
      balances: [{ currency: 'JPY', amount: 30000 }],
      balancesNative: [],
    });

    expect(friendSettleIntent(friend, me)).toEqual({
      disabled: false,
      prefill: { fromUserId: 'me', toUserId: 'sam', amount: 0, currency: 'GBP' },
    });
  });

  it('converted figure present but no native leftover -> amount:0 fallback, never reads balancesConverted amount', () => {
    const friend = fixtureFriend({
      balancesConverted: { currency: 'GBP', amount: -9735 },
      balances: [],
    });

    const result = friendSettleIntent(friend, me);
    expect(result.disabled).toBe(false);
    expect(result.prefill).toEqual({ fromUserId: 'me', toUserId: 'sam', amount: 0, currency: 'GBP' });
    expect(result.prefill).not.toMatchObject({ amount: 9735 });
  });

  it('nothing outstanding (no native leftover, no converted figure) -> disabled = true, prefill undefined', () => {
    const friend = fixtureFriend({ balances: [], balancesConverted: null });

    expect(friendSettleIntent(friend, me)).toEqual({ disabled: true, prefill: undefined });
  });

  it('nothing outstanding with an explicit zero-amount converted object also disables (defensive)', () => {
    const friend = fixtureFriend({
      balances: [],
      balancesConverted: { currency: 'GBP', amount: 0 },
    });

    expect(friendSettleIntent(friend, me)).toEqual({ disabled: true, prefill: undefined });
  });

  it('no actor (me is null/undefined) -> prefill undefined even when something is outstanding', () => {
    const friend = fixtureFriend({ balances: [{ currency: 'JPY', amount: 30000 }] });

    expect(friendSettleIntent(friend, null)).toEqual({ disabled: false, prefill: undefined });
    expect(friendSettleIntent(friend, undefined)).toEqual({ disabled: false, prefill: undefined });
  });
});
