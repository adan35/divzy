import { describe, expect, it } from 'vitest';
import { activityRowVisualState } from './activityRowStyle';

// Tests written from spec-WI-054 §4 (strikethrough on deletedAt) and
// spec-WI-055 §3/§4 (actor-relative color, neutral when struck-through)
// before `activityRowStyle.ts` existed.

describe('activityRowVisualState', () => {
  it('is neutral (not struck, no accent) when deletedAt and colorHint are both null', () => {
    expect(activityRowVisualState({ deletedAt: null, colorHint: null })).toEqual({
      struck: false,
      accent: null,
    });
  });

  it('is neutral when colorHint is absent (undefined, optional-typed DTO field)', () => {
    expect(activityRowVisualState({ deletedAt: null, colorHint: undefined })).toEqual({
      struck: false,
      accent: null,
    });
  });

  it('is green-accented when colorHint is "green" and the row is not deleted', () => {
    expect(activityRowVisualState({ deletedAt: null, colorHint: 'green' })).toEqual({
      struck: false,
      accent: 'pos',
    });
  });

  it('is red-accented when colorHint is "red" and the row is not deleted', () => {
    expect(activityRowVisualState({ deletedAt: null, colorHint: 'red' })).toEqual({
      struck: false,
      accent: 'neg',
    });
  });

  it('is struck-through with no accent when deletedAt is set (server already forces colorHint null)', () => {
    expect(
      activityRowVisualState({ deletedAt: '2026-07-18T00:00:00.000Z', colorHint: null }),
    ).toEqual({ struck: true, accent: null });
  });

  it('defensively suppresses accent on a struck-through row even if colorHint were non-null', () => {
    // Belt-and-suspenders: spec-WI-055 §3 guarantees the server never sends
    // this combination, but a struck-through row must never show color
    // client-side regardless (ADR-027 "the two signals never compete").
    expect(
      activityRowVisualState({ deletedAt: '2026-07-18T00:00:00.000Z', colorHint: 'green' }),
    ).toEqual({ struck: true, accent: null });
  });
});
