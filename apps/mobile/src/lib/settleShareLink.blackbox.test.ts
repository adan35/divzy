// Test-stage independent black-box coverage — story-WI-016 Part B (settle-up
// link/QR), mobile. Derived directly from story-WI-016.md's Gherkin
// ("No external payment-app URI scheme is ever produced", "Generating a
// settle-up link ... carrying exactly those prefilled values") and
// ADR-013's canonical link shape, using this file's own fixtures rather than
// Build's `settleShareLink.test.ts` — an independent re-verification, not a
// duplicate, per this domain's practice of not taking Build's own coverage
// on faith.
import { describe, expect, it } from 'vitest';
import { buildSettleShareLink } from './settleShareLink';

const WEB_URL = 'https://app.divzy.example';

describe('buildSettleShareLink — independent black-box re-verification (story-WI-016 §B)', () => {
  it('never produces an external payment-app URI scheme (venmo://, paypal://, or any non-http(s) scheme)', () => {
    const link = buildSettleShareLink(
      { fromUserId: 'user_id_ana1', toUserId: 'user_id_bob1', amount: 12345, currency: 'GBP' },
      WEB_URL,
    );

    const scheme = link.split('://')[0];
    expect(scheme).toBe('https');
    expect(link).not.toMatch(/venmo:\/\//i);
    expect(link).not.toMatch(/paypal:\/\//i);
  });

  it('never collects or embeds any external payment-handle-shaped field (no "handle"/"venmoUsername"/"paypalMe" params)', () => {
    const link = buildSettleShareLink(
      { fromUserId: 'user_id_ana1', toUserId: 'user_id_bob1', amount: 500, currency: 'PKR' },
      WEB_URL,
    );

    expect(link).not.toMatch(/handle=/i);
    expect(link).not.toMatch(/venmo/i);
    expect(link).not.toMatch(/paypal/i);
  });

  it('carries exactly the prefilled values from story\'s worked example (Ana->Bob, 500 PKR, group Trip) — round-trips byte-for-byte', () => {
    const link = buildSettleShareLink(
      {
        fromUserId: 'user_id_ana1',
        toUserId: 'user_id_bob1',
        amount: 500,
        currency: 'PKR',
        groupId: 'group_id_trip1',
      },
      WEB_URL,
    );

    expect(link).toBe(
      'https://app.divzy.example/settle?fromUserId=user_id_ana1&toUserId=user_id_bob1&amount=500&currency=PKR&groupId=group_id_trip1',
    );
  });

  it('a zero-decimal-currency amount (e.g. JPY) still round-trips as a bare integer, no decimal point ever introduced', () => {
    const link = buildSettleShareLink(
      { fromUserId: 'user_id_ana1', toUserId: 'user_id_bob1', amount: 5000, currency: 'JPY' },
      WEB_URL,
    );

    expect(link).toContain('amount=5000&currency=JPY');
    expect(link).not.toMatch(/amount=\d+\.\d+/);
  });
});
