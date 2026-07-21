import { describe, expect, it } from 'vitest';
import { GROUP_EMOJI_CHOICES } from '@divzy/shared';
import { pickerEmojis } from './emojiPicker';

// Tests written from spec-WI-031's D1/D2 before emojiPicker.ts exists — pins
// the "never drop the current selection" fallback (mirrors web's `gridEmojis`
// logic in group-form-dialog.tsx) on top of the shared `searchGroupEmoji`
// substring filter.

describe('pickerEmojis', () => {
  it('returns the full curated list on an empty query', () => {
    expect(pickerEmojis('', '👥')).toEqual([...GROUP_EMOJI_CHOICES]);
  });

  it('narrows to matches on a nonempty query', () => {
    const result = pickerEmojis('pizza', '👥');
    expect(result).toContain('🍕');
    expect(result.length).toBeLessThan(GROUP_EMOJI_CHOICES.length);
  });

  it('does not duplicate the selected emoji when it already matches the query', () => {
    const result = pickerEmojis('pizza', '🍕');
    expect(result.filter((e) => e === '🍕')).toHaveLength(1);
  });

  it('prepends the current selection when the query filters it out (never drops it)', () => {
    const result = pickerEmojis('pizza', '✈️');
    expect(result[0]).toBe('✈️');
    expect(result).toContain('🍕');
  });

  it('keeps a stale/custom emoji (outside the curated set) visible even on an empty query', () => {
    const result = pickerEmojis('', '🦄');
    expect(result[0]).toBe('🦄');
    expect(result).toEqual(['🦄', ...GROUP_EMOJI_CHOICES]);
  });

  it('returns an empty array when nothing matches and the selection is already shown separately', () => {
    // A query with zero matches and a selection that also doesn't match still
    // surfaces the selection alone (never an empty screen with a silently
    // lost selection).
    const result = pickerEmojis('zzzznomatch', '🍕');
    expect(result).toEqual(['🍕']);
  });
});
