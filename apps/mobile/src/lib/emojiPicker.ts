import { searchGroupEmoji } from '@divzy/shared';

/**
 * Search results for the group-emoji picker (WI-031), plus the "never lose
 * the current selection" fallback: if `selected` doesn't already appear in
 * the query's results (either because it's a stale/custom emoji outside the
 * curated `GROUP_EMOJI_CHOICES` set, or because the current query happens to
 * filter it out), it is prepended so re-opening or narrowing the search never
 * silently drops the active selection. Mirrors web's `gridEmojis` fallback in
 * group-form-dialog.tsx.
 */
export function pickerEmojis(query: string, selected: string): string[] {
  const results = searchGroupEmoji(query);
  if (results.includes(selected)) return [...results];
  return [selected, ...results];
}
