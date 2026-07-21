import { describe, expect, it } from 'vitest';
import { shouldShowAvatarImage } from './avatar';

describe('shouldShowAvatarImage — Avatar image-vs-initials fallback gating (WI-035)', () => {
  it('is false when avatarUrl is null (no photo — initials render)', () => {
    expect(shouldShowAvatarImage(null, null)).toBe(false);
  });

  it('is false when avatarUrl is undefined', () => {
    expect(shouldShowAvatarImage(undefined, null)).toBe(false);
  });

  it('is false for an empty-string avatarUrl', () => {
    expect(shouldShowAvatarImage('', null)).toBe(false);
  });

  it('is true when avatarUrl is set and has not failed to load', () => {
    expect(shouldShowAvatarImage('/uploads/avatars/abc.jpg', null)).toBe(true);
  });

  it('is false when avatarUrl is the exact url that previously failed to load (broken-image fallback)', () => {
    expect(shouldShowAvatarImage('/uploads/avatars/abc.jpg', '/uploads/avatars/abc.jpg')).toBe(
      false,
    );
  });

  it('is true when avatarUrl differs from the previously-failed url (e.g. photo was replaced) — gets a fresh attempt', () => {
    expect(shouldShowAvatarImage('/uploads/avatars/new.jpg', '/uploads/avatars/old.jpg')).toBe(
      true,
    );
  });
});
