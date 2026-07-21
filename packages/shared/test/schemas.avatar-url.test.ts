// WI-035 (DRB security condition, blocking) — avatarUrl must be constrained
// to the exact path shape POST /uploads/avatars produces
// (/uploads/avatars/<32 lowercase hex>.<jpg|png|webp|heic|heif>), never a bare
// .max(500) string. This is what stops a client PATCHing avatarUrl to an
// external URL or another domain's /uploads/<kind>/... asset.
import { describe, expect, it } from 'vitest';
import { AVATAR_URL_PATTERN, zAvatarUrl, zUpdateMeInput } from '../src/schemas';

const VALID = '/uploads/avatars/0123456789abcdef0123456789abcdef.jpg';

describe('zAvatarUrl / AVATAR_URL_PATTERN (WI-035)', () => {
  it('accepts a valid avatars path for every allow-listed extension', () => {
    for (const ext of ['jpg', 'png', 'webp', 'heic', 'heif']) {
      const url = `/uploads/avatars/${'a'.repeat(32)}.${ext}`;
      expect(zAvatarUrl.parse(url)).toBe(url);
      expect(AVATAR_URL_PATTERN.test(url)).toBe(true);
    }
  });

  it('rejects an external URL', () => {
    expect(() => zAvatarUrl.parse('https://evil.com/track.png?u=1')).toThrow();
  });

  it('rejects a data: URI', () => {
    expect(() => zAvatarUrl.parse('data:image/png;base64,AAAA')).toThrow();
  });

  it('rejects a path into a different /uploads subdirectory (e.g. receipts)', () => {
    expect(() => zAvatarUrl.parse('/uploads/receipts/0123456789abcdef0123456789abcdef.jpg')).toThrow();
  });

  it('rejects path traversal', () => {
    expect(() => zAvatarUrl.parse('/uploads/avatars/../../etc/passwd')).toThrow();
  });

  it('rejects an unsupported extension (e.g. svg, pdf)', () => {
    expect(() => zAvatarUrl.parse(`/uploads/avatars/${'a'.repeat(32)}.svg`)).toThrow();
    expect(() => zAvatarUrl.parse(`/uploads/avatars/${'a'.repeat(32)}.pdf`)).toThrow();
  });

  it('rejects a hex segment of the wrong length', () => {
    expect(() => zAvatarUrl.parse('/uploads/avatars/abc.jpg')).toThrow();
  });

  it('rejects uppercase hex (the route only ever generates lowercase)', () => {
    expect(() => zAvatarUrl.parse(`/uploads/avatars/${'A'.repeat(32)}.jpg`)).toThrow();
  });
});

describe('zUpdateMeInput.avatarUrl (WI-035)', () => {
  it('accepts a valid avatars path', () => {
    const result = zUpdateMeInput.parse({ avatarUrl: VALID });
    expect(result.avatarUrl).toBe(VALID);
  });

  it('accepts explicit null (clears the avatar)', () => {
    const result = zUpdateMeInput.parse({ avatarUrl: null });
    expect(result.avatarUrl).toBeNull();
  });

  it('leaves avatarUrl undefined when omitted (does not touch the column)', () => {
    const result = zUpdateMeInput.parse({});
    expect(result.avatarUrl).toBeUndefined();
  });

  it('rejects an external URL at the PATCH /users/me boundary, not just a bare max(500) string', () => {
    expect(() => zUpdateMeInput.parse({ avatarUrl: 'https://evil.com/x.png' })).toThrow();
  });
});
