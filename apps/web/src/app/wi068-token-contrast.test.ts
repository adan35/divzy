// WI-068 — story AC-5 / spec §1.2: every text token clears WCAG 2.1 AA
// (4.5:1) against its surface/page pairing, in BOTH modes. This test parses
// the token VALUES straight out of `globals.css` (single source of truth), so
// any future retune that drops a pair below 4.5:1 fails here — no DOM needed.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.join(__dirname, 'globals.css'), 'utf8');

/** Extract the `--name: #hex;` declarations inside a `selector { ... }` block. */
function parseTokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`selector ${selector} not found in globals.css`);
  const end = css.indexOf('}', start);
  const block = css.slice(start, end);
  const tokens: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    tokens[m[1]!] = m[2]!;
  }
  return tokens;
}

function relativeLuminance(hex: string): number {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const channel = (i: number) => {
    const s = parseInt(h.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** [foreground token, background token] — the spec §1.2 table. */
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['ink', 'surface'],
  ['ink-2', 'surface'],
  ['ink-3', 'surface'],
  ['ink-3', 'page'],
  ['brand', 'surface'], // brand as text/links
  ['pos', 'surface'],
  ['neg', 'surface'],
  ['danger', 'surface'],
  ['warn', 'surface'],
  ['accent', 'surface'], // gold accent as text
  ['on-brand', 'brand-fill'], // button text on button fill
];

describe.each([
  ['light (:root)', ':root'],
  ['dark (.dark)', '.dark'],
])('WI-068 AC-5 token contrast — %s', (_label, selector) => {
  const tokens = parseTokens(selector);

  it.each(PAIRS.map(([fg, bg]) => [fg, bg] as const))(
    '--%s on --%s is >= 4.5:1',
    (fg, bg) => {
      const fgHex = tokens[fg];
      const bgHex = tokens[bg];
      // Every token in the table must exist as a plain hex value in the block.
      expect(fgHex, `--${fg} missing (or not hex) in ${selector}`).toBeTruthy();
      expect(bgHex, `--${bg} missing (or not hex) in ${selector}`).toBeTruthy();
      const ratio = contrast(fgHex!, bgHex!);
      expect(
        ratio,
        `--${fg} (${fgHex}) on --${bg} (${bgHex}) = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    },
  );
});
