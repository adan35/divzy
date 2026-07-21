import { describe, expect, it } from 'vitest';
import { extractFriendCodeFromScan, normalizeFriendCode } from './friendCode';

// Tests written from spec-WI-040 (D1 code format mirrors Group.inviteCode;
// D3 share URL mirrors /join/[code]; scan flow decodes the QR-encoded share
// URL) before friendCode.ts exists.

describe('normalizeFriendCode', () => {
  it('trims and uppercases manual entry', () => {
    expect(normalizeFriendCode('  ab3xk92m7q  ')).toBe('AB3XK92M7Q');
  });

  it('returns an empty string for blank input', () => {
    expect(normalizeFriendCode('   ')).toBe('');
  });
});

describe('extractFriendCodeFromScan', () => {
  it('extracts the code from a web share URL', () => {
    expect(extractFriendCodeFromScan('http://localhost:3000/add-friend/ab3xk92m7q')).toBe(
      'AB3XK92M7Q',
    );
  });

  it('extracts the code from a divzy:// deep link', () => {
    expect(extractFriendCodeFromScan('divzy://add-friend/AB3XK92M7Q')).toBe('AB3XK92M7Q');
  });

  it('accepts a bare code with no URL wrapper', () => {
    expect(extractFriendCodeFromScan('AB3XK92M7Q')).toBe('AB3XK92M7Q');
  });

  it('trims surrounding whitespace on a bare code', () => {
    expect(extractFriendCodeFromScan('  ab3xk92m7q  ')).toBe('AB3XK92M7Q');
  });

  it('ignores a trailing query string on a share URL', () => {
    expect(extractFriendCodeFromScan('http://localhost:3000/add-friend/ab3xk92m7q?ref=qr')).toBe(
      'AB3XK92M7Q',
    );
  });

  it('returns null for an unrecognized/empty scan payload', () => {
    expect(extractFriendCodeFromScan('')).toBeNull();
    expect(extractFriendCodeFromScan('https://example.com/totally/unrelated')).toBeNull();
  });
});
