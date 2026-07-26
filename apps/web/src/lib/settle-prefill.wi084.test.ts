import { describe, expect, it } from 'vitest';
import type { FriendBalanceBucket, FriendDto } from '@divzy/shared';
import {
  bucketSettleIntent,
  groupMemberSettleIntent,
  type SettleActor,
} from './settle-prefill';

function fixtureFriend(overrides: Partial<FriendDto> = {}): FriendDto {
  return {
    user: { id: 'ana', name: 'Ana Diaz', avatarColor: '#222' },
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
    balancesByGroup: [],
    lastActivityAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function fixtureBucket(overrides: Partial<FriendBalanceBucket> = {}): FriendBalanceBucket {
  return {
    group: null,
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
    ...overrides,
  };
}

const me: SettleActor = { id: 'me', defaultCurrency: 'GBP' };

describe('WI-084 — bucketSettleIntent', () => {
  it('group bucket, counterparty owes viewer -> from counterparty to me with groupId', () => {
    const friend = fixtureFriend();
    const bucket = fixtureBucket({
      group: { id: 'g1', name: 'Trip', emoji: '✈️' },
    });
    const line = { currency: 'PKR', amount: 50000 };

    expect(bucketSettleIntent(bucket, line, friend, me)).toEqual({
      groupId: 'g1',
      prefill: { fromUserId: 'ana', toUserId: 'me', amount: 50000, currency: 'PKR' },
    });
  });

  it('group bucket, viewer owes counterparty -> from me to counterparty with groupId', () => {
    const friend = fixtureFriend();
    const bucket = fixtureBucket({
      group: { id: 'g1', name: 'Trip', emoji: '✈️' },
    });
    const line = { currency: 'USD', amount: -1250 };

    expect(bucketSettleIntent(bucket, line, friend, me)).toEqual({
      groupId: 'g1',
      prefill: { fromUserId: 'me', toUserId: 'ana', amount: 1250, currency: 'USD' },
    });
  });

  it('direct bucket omits groupId regardless of direction', () => {
    const friend = fixtureFriend();
    const bucket = fixtureBucket({ group: null });
    const line = { currency: 'USD', amount: -1250 };

    const result = bucketSettleIntent(bucket, line, friend, me);
    expect(result.groupId).toBeUndefined();
    expect(result.prefill).toEqual({
      fromUserId: 'me',
      toUserId: 'ana',
      amount: 1250,
      currency: 'USD',
    });
  });

  it('uses the displayed line currency/amount for multi-currency buckets', () => {
    const friend = fixtureFriend();
    const bucket = fixtureBucket({
      group: { id: 'g1', name: 'Trip', emoji: '✈️' },
    });
    const line = { currency: 'USD', amount: 4500 };

    expect(bucketSettleIntent(bucket, line, friend, me).prefill).toEqual({
      fromUserId: 'ana',
      toUserId: 'me',
      amount: 4500,
      currency: 'USD',
    });
  });
});

describe('WI-084 — groupMemberSettleIntent', () => {
  it('member owes viewer -> from member to me', () => {
    const member = { id: 'bob', name: 'Bob', avatarColor: '#333' };
    const line = { currency: 'PKR', amount: 50000 };

    expect(groupMemberSettleIntent(member, line, me)).toEqual({
      fromUserId: 'bob',
      toUserId: 'me',
      amount: 50000,
      currency: 'PKR',
    });
  });

  it('viewer owes member -> from me to member', () => {
    const member = { id: 'bob', name: 'Bob', avatarColor: '#333' };
    const line = { currency: 'USD', amount: -2000 };

    expect(groupMemberSettleIntent(member, line, me)).toEqual({
      fromUserId: 'me',
      toUserId: 'bob',
      amount: 2000,
      currency: 'USD',
    });
  });
});
