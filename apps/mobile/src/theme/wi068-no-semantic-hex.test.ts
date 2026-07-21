import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { chartOtherColor, chartPalette, darkColors, lightColors } from './tokens';

/**
 * WI-068 story AC-2 — no raw SEMANTIC-color hex in screen/component files.
 * Scanned roots: apps/mobile/app/** and apps/mobile/src/components/**.
 * Allowlist per the story: src/theme (the token source) and test files.
 *
 * Scope note (deliberate, per the story wording "raw semantic-color hex"):
 * pure white/black (#fff/#ffffff/#000/#000000) are NOT flagged — they appear
 * today as platform affordances (Switch thumbColor, QR quiet zones — the QR
 * white-card exception is documented in spec §9.1) and carry no theme
 * semantics. Everything that IS a theme token value (old or new), a chart
 * palette hue, or a legacy semantic color is banned.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOTS = [path.resolve(HERE, '../../app'), path.resolve(HERE, '../components')];
const MOBILE_ROOT = path.resolve(HERE, '../..');

/**
 * TEMPORARY allowlist for pre-existing offenders owned by later WI-068
 * slices. Each entry must be removed by the slice that owns the file.
 * (S7 removed the `app/analytics.tsx` entry — its local chart palette
 * constants now consume the theme's `chartPalette` export, spec §8.1.)
 */
const TEMP_ALLOWLIST = new Set<string>([]);

const NEUTRAL = new Set(['#ffffff', '#000000']);

/** Legacy (pre-WI-068) semantic values — banned so they can't be reintroduced. */
const LEGACY_SEMANTIC = [
  // old brand / brandHover (light, dark)
  '#2a78d6',
  '#256abf',
  '#3987e5',
  '#5598e7',
  // old pos / neg / danger / warning
  '#006300',
  '#0ca30c',
  '#d03b3b',
  '#e66767',
  '#c98500',
  '#eda100',
  // old neutrals (page/surface/ink family)
  '#f9f9f7',
  '#fcfcfb',
  '#f0efec',
  '#0b0b0b',
  '#0d0d0d',
  '#1a1a19',
  '#242422',
  '#52514e',
  '#898781',
  '#c3c2b7',
  // old chart gridlines (spec §1.1 chart-grid note)
  '#e1e0d9',
  '#2c2c2a',
];

function semanticHexSet(): Set<string> {
  const set = new Set<string>();
  for (const colors of [lightColors, darkColors]) {
    for (const value of Object.values(colors)) {
      const v = String(value).toLowerCase();
      if (v.startsWith('#') && !NEUTRAL.has(v)) set.add(v);
    }
  }
  for (const hue of [...chartPalette.light, ...chartPalette.dark]) set.add(hue.toLowerCase());
  set.add(chartOtherColor.toLowerCase());
  for (const legacy of LEGACY_SEMANTIC) set.add(legacy);
  return set;
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

/** Normalize any #rgb/#rgba/#rrggbb/#rrggbbaa literal to lowercase #rrggbb. */
function normalizeHex(raw: string): string {
  const hex = raw.toLowerCase();
  const digits = hex.slice(1);
  if (digits.length === 3 || digits.length === 4) {
    const [r, g, b] = digits;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return `#${digits.slice(0, 6)}`;
}

describe('WI-068 story AC-2 — no raw semantic-color hex in app/** or src/components/**', () => {
  it('finds no semantic hex literal outside the theme module', () => {
    const banned = semanticHexSet();
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of listSourceFiles(root)) {
        const rel = path.relative(MOBILE_ROOT, file).replace(/\\/g, '/');
        if (TEMP_ALLOWLIST.has(rel)) continue;
        const content = readFileSync(file, 'utf8');
        for (const match of content.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
          const normalized = normalizeHex(match[0]);
          if (banned.has(normalized)) offenders.push(`${rel}: ${match[0]}`);
        }
      }
    }

    expect(offenders, `semantic hex literals must come from the theme:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('temp-allowlisted files still exist (stale entries must be deleted)', () => {
    for (const rel of TEMP_ALLOWLIST) {
      expect(() => statSync(path.join(MOBILE_ROOT, rel))).not.toThrow();
    }
  });
});
