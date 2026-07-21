import { describe, expect, it } from 'vitest';
import { friendSettleParams } from './settlements';

/**
 * Originally (WI-010) a hand-mirrored, byte-for-byte transcription of
 * `friend/[id].tsx`'s `openSettle` closure, because the logic lived as an
 * unexported closure with no module-level symbol to import (see the git
 * history of this file for that version's docstring and its documented
 * "mirror can drift" caveat).
 *
 * spec-WI-050 (REOPENED) extracted that logic into the real, importable
 * `friendSettleParams` (`./settlements.ts`) — both to fix its root-cause bug
 * (it was reading `FriendDto.balances`, the WI-001-narrowed leftover field,
 * instead of `balancesNative`) and, per spec-WI-050 §9 task 3's "recommended"
 * note, to align mobile with web's exactly-one-native-currency guard. This
 * file now imports the real function — the mirroring caveat no longer
 * applies. The original WI-010 T3a-T3c scenarios are preserved below (T3c-alt
 * included) so this remains a regression pin for the same directions, now
 * exercised against the real implementation instead of a hand-copied stand-in.
 *
 * Full "which field does the caller pass" regression coverage (the actual
 * WI-050 bug) lives in `settlements.test.ts`'s `friendSettleParams (WI-050)`
 * describe block, alongside the ambiguous-fallback and ADR-021 orthogonality
 * cases spec-WI-050's "Required regression tests" calls for.
 */
describe('WI-010 (mobile) · friend/[id].tsx Settle Up prefill direction (T3) — now via real friendSettleParams (WI-050)', () => {
  it('T3a: positive primary native balance (friend owes the current user) -> From=friend, To=me', () => {
    const params = friendSettleParams([{ amount: 5000, currency: 'PKR' }], 'sam', 'me');
    expect(params).toEqual({
      friendId: 'sam',
      amount: '5000',
      currency: 'PKR',
      fromUserId: 'sam',
      toUserId: 'me',
    });
  });

  it('T3b: negative primary native balance (current user owes the friend) -> From=me, To=friend', () => {
    const params = friendSettleParams([{ amount: -5000, currency: 'PKR' }], 'sam', 'me');
    expect(params).toEqual({
      friendId: 'sam',
      amount: '5000',
      currency: 'PKR',
      fromUserId: 'me',
      toUserId: 'sam',
    });
  });

  it('T3c: no nonzero native balance (settled up) -> safe default From=me, To=friend, no amount/currency params', () => {
    const params = friendSettleParams([], 'sam', 'me');
    expect(params).toEqual({
      friendId: 'sam',
      fromUserId: 'me',
      toUserId: 'sam',
    });
    // Explicit per the real code's zero-branch: it never sets amount/currency
    // at all (unlike web, which defaults amount to 0) — verify this doesn't
    // regress into inventing an amount/currency key.
    expect(params.amount).toBeUndefined();
    expect(params.currency).toBeUndefined();
  });

  it('T3c-alt: a present-but-fully-zeroed balances array hits the same safe default as an empty array', () => {
    const params = friendSettleParams([{ amount: 0, currency: 'USD' }], 'sam', 'me');
    expect(params).toEqual({ friendId: 'sam', fromUserId: 'me', toUserId: 'sam' });
  });
});
