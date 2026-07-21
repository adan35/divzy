// WI-068 — story AC-2: no raw semantic-color hex literals in web components
// or app files. All color must flow through the token utilities mapped in
// tailwind.config.ts. Allowlist (per the story): the chart palette module
// (validated slot hex values live there by design), test files (fixtures use
// literal avatarColor strings), and globals.css itself (the token source).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.join(__dirname, '..');
const SCAN_ROOTS = [path.join(SRC, 'components'), path.join(SRC, 'app')];

const ALLOWLIST = [
  path.join('components', 'analytics', 'palette.ts'),
  path.join('app', 'globals.css'),
];

const HEX_LITERAL = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;

function isAllowed(file: string): boolean {
  const rel = path.relative(SRC, file);
  if (/\.test\.(ts|tsx)$/.test(rel)) return true;
  return ALLOWLIST.some((a) => rel === a);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(p);
  }
  return out;
}

describe('WI-068 AC-2 — no raw hex colors outside the allowlist (web)', () => {
  it('scans apps/web/src/components and apps/web/src/app', () => {
    const violations: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of walk(root)) {
        if (isAllowed(file)) continue;
        const text = readFileSync(file, 'utf8');
        const lines = text.split('\n');
        lines.forEach((line, i) => {
          const matches = line.match(HEX_LITERAL);
          if (matches) {
            violations.push(
              `${path.relative(SRC, file)}:${i + 1} -> ${matches.join(', ')}`,
            );
          }
        });
      }
    }
    expect(
      violations,
      `Raw hex color literals found (use token utilities instead):\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
