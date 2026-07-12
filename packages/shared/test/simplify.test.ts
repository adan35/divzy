import { describe, expect, it } from 'vitest';
import { simplifyDebts } from '../src/simplify';

const A = 'user_a';
const B = 'user_b';
const C = 'user_c';
const D = 'user_d';

describe('simplifyDebts', () => {
  it('settles a simple two-person debt', () => {
    expect(
      simplifyDebts([
        { userId: A, amount: -100 },
        { userId: B, amount: 100 },
      ]),
    ).toEqual([{ fromUserId: A, toUserId: B, amount: 100 }]);
  });

  it('collapses chains (A owes B owes C) into a direct transfer', () => {
    // A: -100, B: 0, C: +100
    expect(
      simplifyDebts([
        { userId: A, amount: -100 },
        { userId: B, amount: 0 },
        { userId: C, amount: 100 },
      ]),
    ).toEqual([{ fromUserId: A, toUserId: C, amount: 100 }]);
  });

  it('produces at most n-1 transfers', () => {
    const nets = [
      { userId: A, amount: -500 },
      { userId: B, amount: -250 },
      { userId: C, amount: 300 },
      { userId: D, amount: 450 },
    ];
    const transfers = simplifyDebts(nets);
    expect(transfers.length).toBeLessThanOrEqual(3);
    // every user ends at zero
    const finals = new Map<string, number>(nets.map((n) => [n.userId, n.amount]));
    for (const t of transfers) {
      finals.set(t.fromUserId, (finals.get(t.fromUserId) ?? 0) + t.amount);
      finals.set(t.toUserId, (finals.get(t.toUserId) ?? 0) - t.amount);
    }
    for (const v of finals.values()) expect(v).toBe(0);
  });

  it('is deterministic under input reordering', () => {
    const nets = [
      { userId: C, amount: 300 },
      { userId: A, amount: -500 },
      { userId: D, amount: 450 },
      { userId: B, amount: -250 },
    ];
    expect(simplifyDebts(nets)).toEqual(simplifyDebts([...nets].reverse()));
  });

  it('breaks amount ties by userId', () => {
    const transfers = simplifyDebts([
      { userId: B, amount: -100 },
      { userId: A, amount: -100 },
      { userId: D, amount: 100 },
      { userId: C, amount: 100 },
    ]);
    expect(transfers).toEqual([
      { fromUserId: A, toUserId: C, amount: 100 },
      { fromUserId: B, toUserId: D, amount: 100 },
    ]);
  });

  it('returns empty for all-zero nets', () => {
    expect(simplifyDebts([{ userId: A, amount: 0 }])).toEqual([]);
    expect(simplifyDebts([])).toEqual([]);
  });

  it('throws when nets do not sum to zero', () => {
    expect(() => simplifyDebts([{ userId: A, amount: 5 }])).toThrow();
  });
});
