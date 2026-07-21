import { describe, expect, it } from 'vitest';
import { CURRENCIES, formatMoney } from '@divzy/shared';
import { formatTickerText, moneyTickerDescriptor } from './motion';

/**
 * WI-068 spec §3 — the MoneyText count-up renders intermediate frames on the
 * reanimated UI thread, where `formatMoney` (Intl) cannot be called. The
 * ticker instead uses a JS-thread-derived descriptor + a worklet-safe pure
 * formatter. This suite is the parity contract: for every supported currency
 * the ticker output must be byte-identical to `formatMoney`, so the animated
 * figure never disagrees with the resting figure a static MoneyText shows.
 */

const AMOUNTS = [
  0, 1, -1, 7, 99, -99, 100, 101, 999, 1000, -1000, 9999, 10000, 12345, -12345, 100000, 999999,
  1000000, 123456789, -123456789, 987654321012, -987654321012,
];

describe('WI-068 money ticker parity with formatMoney', () => {
  for (const currency of CURRENCIES) {
    it(`matches formatMoney for every probe amount — ${currency.code} (${currency.decimals}dp)`, () => {
      const desc = moneyTickerDescriptor(currency.code);
      for (const minor of AMOUNTS) {
        expect(formatTickerText(minor, desc), `${currency.code} ${minor}`).toBe(
          formatMoney(minor, currency.code),
        );
      }
    });
  }

  it('honors an explicit locale, including suffix-symbol + comma-decimal shapes (de-DE)', () => {
    const desc = moneyTickerDescriptor('EUR', 'de-DE');
    for (const minor of AMOUNTS) {
      expect(formatTickerText(minor, desc)).toBe(formatMoney(minor, 'EUR', 'de-DE'));
    }
  });

  it('honors locales with min-grouping-digits quirks (es-ES: 1000 ungrouped)', () => {
    const desc = moneyTickerDescriptor('EUR', 'es-ES');
    for (const minor of [100000, 999900, 1000000, 1234567]) {
      expect(formatTickerText(minor, desc)).toBe(formatMoney(minor, 'EUR', 'es-ES'));
    }
  });

  it('honors Indian grouping (en-IN: 12,34,567)', () => {
    const desc = moneyTickerDescriptor('INR', 'en-IN');
    for (const minor of AMOUNTS) {
      expect(formatTickerText(minor, desc)).toBe(formatMoney(minor, 'INR', 'en-IN'));
    }
  });

  it('descriptor is a plain serializable object (safe to capture in a worklet closure)', () => {
    const desc = moneyTickerDescriptor('USD');
    expect(JSON.parse(JSON.stringify(desc))).toEqual(desc);
  });

  it('rounds fractional shared-value frames to whole minor units', () => {
    const desc = moneyTickerDescriptor('USD');
    expect(formatTickerText(1234.49, desc)).toBe(formatMoney(1234, 'USD'));
    expect(formatTickerText(1234.51, desc)).toBe(formatMoney(1235, 'USD'));
  });
});
