import type { ActivityDto } from '@divzy/shared';

export interface ActivityRowVisualState {
  /** WI-054 (ADR-027) — deletedAt != null drives a strikethrough on the sentence. */
  struck: boolean;
  /**
   * WI-055 — actor-relative color accent, mapped onto this app's existing
   * `colors.pos`/`colors.neg` tokens (never a new hex value). `null` = no
   * accent (today's neutral styling), including whenever the row is
   * struck-through (§3 "the two signals never compete" — enforced here too,
   * defensively, even though the server already forces `colorHint: null` on
   * a deleted row).
   */
  accent: 'pos' | 'neg' | null;
}

/**
 * Pure mapping from `ActivityDto.deletedAt`/`colorHint` to the visual state
 * `ActivityRow` renders. Kept separate from the component (no RN render
 * harness in this repo — see apps/mobile agent-memory
 * gap_mobile-no-render-harness.md) so the WI-054/WI-055 rules are unit
 * testable.
 */
export function activityRowVisualState(
  activity: Pick<ActivityDto, 'deletedAt' | 'colorHint'>,
): ActivityRowVisualState {
  const struck = activity.deletedAt !== null;
  const accent = struck
    ? null
    : activity.colorHint === 'green'
      ? 'pos'
      : activity.colorHint === 'red'
        ? 'neg'
        : null;
  return { struck, accent };
}
