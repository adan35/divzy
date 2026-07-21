/**
 * Client-side avatar upload pre-validation (WI-035 §5) — mirrors the
 * server's own `MAX_UPLOAD_MB` cap and image-only MIME allow-list
 * (`apps/api/src/routes/uploads.ts` `AVATAR_EXTENSION_BY_MIME`) so a bad
 * pick is rejected instantly, before a network round trip. Defense in
 * depth only — the server independently re-validates and is the source of
 * truth; this never replaces that check.
 */
export const AVATAR_MAX_BYTES = 10 * 1024 * 1024; // 10 MB, mirrors MAX_UPLOAD_MB default

/** Byte-for-byte the same allow-list as the server's AVATAR_EXTENSION_BY_MIME keys. */
export const AVATAR_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export interface AvatarFileMeta {
  /** Bytes, if known — some pickers/platforms omit fileSize. */
  size?: number | null;
  mimeType?: string | null;
}

export interface AvatarValidationResult {
  ok: boolean;
  /** User-facing rejection reason. Present iff ok is false. */
  message?: string;
}

export function validateAvatarFile(meta: AvatarFileMeta): AvatarValidationResult {
  if (meta.mimeType) {
    const normalized = meta.mimeType.toLowerCase();
    if (!(AVATAR_ALLOWED_MIME_TYPES as readonly string[]).includes(normalized)) {
      return { ok: false, message: 'Please choose a JPEG, PNG, WebP, HEIC or HEIF image.' };
    }
  }
  if (typeof meta.size === 'number' && meta.size > AVATAR_MAX_BYTES) {
    return { ok: false, message: 'That image is too large — please choose one under 10 MB.' };
  }
  return { ok: true };
}
