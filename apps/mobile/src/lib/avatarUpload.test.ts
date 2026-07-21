import { describe, expect, it } from 'vitest';
import { AVATAR_MAX_BYTES, validateAvatarFile } from './avatarUpload';

describe('validateAvatarFile — client-side pre-validation before uploading (WI-035 §5)', () => {
  it('accepts a valid JPEG under the size cap', () => {
    expect(validateAvatarFile({ mimeType: 'image/jpeg', size: 1024 })).toEqual({ ok: true });
  });

  it('accepts every server-allow-listed MIME type (jpeg/png/webp/heic/heif)', () => {
    for (const mimeType of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) {
      expect(validateAvatarFile({ mimeType, size: 1024 }).ok).toBe(true);
    }
  });

  it('is case-insensitive on the MIME type', () => {
    expect(validateAvatarFile({ mimeType: 'IMAGE/JPEG', size: 1024 })).toEqual({ ok: true });
  });

  it('rejects an unsupported MIME type (e.g. PDF — receipts allow it, avatars do not)', () => {
    const result = validateAvatarFile({ mimeType: 'application/pdf', size: 1024 });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/JPEG|PNG|WebP|HEIC|HEIF/i);
  });

  it('rejects SVG (anti-stored-XSS, mirrors the server allow-list)', () => {
    expect(validateAvatarFile({ mimeType: 'image/svg+xml', size: 1024 }).ok).toBe(false);
  });

  it('rejects a file over the 10 MB cap', () => {
    const result = validateAvatarFile({ mimeType: 'image/jpeg', size: AVATAR_MAX_BYTES + 1 });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/10\s?MB/i);
  });

  it('accepts a file exactly at the size cap (boundary — not over)', () => {
    expect(validateAvatarFile({ mimeType: 'image/jpeg', size: AVATAR_MAX_BYTES }).ok).toBe(true);
  });

  it('does not block on an unknown size (some pickers omit fileSize) — server still enforces', () => {
    expect(validateAvatarFile({ mimeType: 'image/jpeg', size: null }).ok).toBe(true);
    expect(validateAvatarFile({ mimeType: 'image/jpeg' }).ok).toBe(true);
  });

  it('does not block on an unknown MIME type — server still enforces', () => {
    expect(validateAvatarFile({ size: 1024 }).ok).toBe(true);
  });
});
