// WI-045 (ADR-023) — User.phone as a second login identifier + second
// /users/search key. zPhone strips common formatting characters before
// matching an E.164-ish shape (leading "+", non-zero first digit, 8-15
// total digits); zLoginInput classifies a single `identifier` field into
// `email` or `phone` kind (never both, never neither silently).
import { describe, expect, it } from 'vitest';
import {
  PHONE_PATTERN,
  zLoginInput,
  zPhone,
  zUpdateMeInput,
  zUserSearchQuery,
} from '../src/schemas';

describe('zPhone / PHONE_PATTERN (WI-045)', () => {
  it('accepts a canonical E.164 number', () => {
    expect(zPhone.parse('+14155552671')).toBe('+14155552671');
    expect(PHONE_PATTERN.test('+14155552671')).toBe(true);
  });

  it('strips spaces, hyphens, dots, and parens before validating', () => {
    expect(zPhone.parse('+1 415-555-2671')).toBe('+14155552671');
    expect(zPhone.parse('+1 (415) 555.2671')).toBe('+14155552671');
  });

  it('trims surrounding whitespace', () => {
    expect(zPhone.parse('  +14155552671  ')).toBe('+14155552671');
  });

  it('rejects a number missing the leading +', () => {
    expect(() => zPhone.parse('14155552671')).toThrow();
  });

  it('rejects a leading zero after the +', () => {
    expect(() => zPhone.parse('+0123456789')).toThrow();
  });

  it('rejects too few digits (below the 8-digit-total floor)', () => {
    expect(() => zPhone.parse('+1234567')).toThrow();
  });

  it('rejects too many digits (above the 15-digit E.164 cap)', () => {
    expect(() => zPhone.parse('+1234567890123456')).toThrow();
  });

  it('rejects a non-numeric identifier (e.g. an email)', () => {
    expect(() => zPhone.parse('sam@example.com')).toThrow();
  });
});

describe('zLoginInput (WI-045, Q1 single-identifier shape)', () => {
  it('classifies an email-shaped identifier as kind "email"', () => {
    const result = zLoginInput.parse({ identifier: 'Sam@Example.com', password: 'hunter2' });
    expect(result).toEqual({ kind: 'email', identifier: 'sam@example.com', password: 'hunter2' });
  });

  it('classifies a phone-shaped identifier as kind "phone"', () => {
    const result = zLoginInput.parse({ identifier: '+1 415-555-2671', password: 'hunter2' });
    expect(result).toEqual({ kind: 'phone', identifier: '+14155552671', password: 'hunter2' });
  });

  it('rejects an identifier matching neither shape with a 400-worthy validation error', () => {
    expect(() => zLoginInput.parse({ identifier: 'not-an-identifier', password: 'hunter2' })).toThrow();
  });

  it('rejects an empty identifier', () => {
    expect(() => zLoginInput.parse({ identifier: '', password: 'hunter2' })).toThrow();
  });
});

describe('zUpdateMeInput.phone (WI-045)', () => {
  it('accepts a valid phone', () => {
    const result = zUpdateMeInput.parse({ phone: '+14155552671' });
    expect(result.phone).toBe('+14155552671');
  });

  it('accepts explicit null (clears the phone)', () => {
    const result = zUpdateMeInput.parse({ phone: null });
    expect(result.phone).toBeNull();
  });

  it('leaves phone undefined when omitted (does not touch the column)', () => {
    const result = zUpdateMeInput.parse({});
    expect(result.phone).toBeUndefined();
  });

  it('rejects a malformed phone', () => {
    expect(() => zUpdateMeInput.parse({ phone: 'not-a-phone' })).toThrow();
  });
});

describe('zUserSearchQuery (WI-045, XOR email/phone)', () => {
  it('accepts email alone', () => {
    const result = zUserSearchQuery.parse({ email: 'sam@example.com' });
    expect(result).toEqual({ email: 'sam@example.com' });
  });

  it('accepts phone alone', () => {
    const result = zUserSearchQuery.parse({ phone: '+14155552671' });
    expect(result).toEqual({ phone: '+14155552671' });
  });

  it('rejects neither present', () => {
    expect(() => zUserSearchQuery.parse({})).toThrow();
  });

  it('rejects both present', () => {
    expect(() =>
      zUserSearchQuery.parse({ email: 'sam@example.com', phone: '+14155552671' }),
    ).toThrow();
  });
});
