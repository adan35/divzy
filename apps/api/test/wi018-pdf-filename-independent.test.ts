// Test-stage independent verification of story-WI-018's "Filename handling
// mirrors the CSV export's pattern" AC — a non-ASCII group name must produce
// both an ASCII-safe fallback filename AND an RFC 5987 UTF-8 filename*
// variant on GET /groups/:groupId/export.pdf, exactly as export.csv already
// does. Written directly from the story's Gherkin scenario, not from Build's
// own pdf-export-route.test.ts (which only asserts the header is *present*
// with an ASCII fixture group name — it never exercises a non-ASCII name, so
// this closes that gap). Also re-verifies export.csv's own filename output is
// unaffected by the WI-018 refactor that extracted the shared
// `loadGroupExportData`/`exportContentDisposition` helpers both routes now
// call (regression AC: "the existing CSV export is unchanged").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const groupMemberFindFirstMock = vi.fn();
const groupMemberFindManyMock = vi.fn();
const groupFindUniqueMock = vi.fn();
const expenseFindManyMock = vi.fn();
const settlementFindManyMock = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    group: { findUnique: (...args: unknown[]) => groupFindUniqueMock(...args) },
    groupMember: {
      findFirst: (...args: unknown[]) => groupMemberFindFirstMock(...args),
      findMany: (...args: unknown[]) => groupMemberFindManyMock(...args),
    },
    expense: { findMany: (...args: unknown[]) => expenseFindManyMock(...args) },
    settlement: { findMany: (...args: unknown[]) => settlementFindManyMock(...args) },
  },
}));

import { buildApp } from '../src/app';

let app: FastifyInstance;
let token: string;

const USER_ID = 'user_1_wi018f';
const GROUP_ID = 'group_id_wi018f';
const NON_ASCII_NAME = "Café à Paris 🎉 / trip \"2026\"";

beforeEach(async () => {
  groupMemberFindFirstMock.mockReset();
  groupMemberFindManyMock.mockReset();
  groupFindUniqueMock.mockReset();
  expenseFindManyMock.mockReset();
  settlementFindManyMock.mockReset();

  groupMemberFindFirstMock.mockResolvedValue({ id: 'gm_1' });
  groupFindUniqueMock.mockResolvedValue({ name: NON_ASCII_NAME });
  groupMemberFindManyMock.mockResolvedValue([
    { userId: USER_ID, user: { name: 'Zain' } },
    { userId: 'user_2_wi018f', user: { name: 'Friend' } },
  ]);
  expenseFindManyMock.mockResolvedValue([]);
  settlementFindManyMock.mockResolvedValue([]);

  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: USER_ID });
});

afterEach(async () => {
  await app.close();
});

function disposition(res: { headers: Record<string, unknown> }): string {
  return String(res.headers['content-disposition']);
}

describe('Non-ASCII group name — dual-filename content-disposition (story-WI-018 AC)', () => {
  it('export.pdf provides an ASCII-safe fallback filename AND an RFC 5987 filename* UTF-8 variant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${GROUP_ID}/export.pdf`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const cd = disposition(res);

    // ASCII fallback: non-ASCII chars (é, à, 🎉) and filesystem-unsafe chars
    // (", /) stripped; extension is .pdf.
    expect(cd).toMatch(/filename="[^"]*\.pdf"/);
    const asciiMatch = cd.match(/filename="([^"]*)\.pdf"/);
    expect(asciiMatch?.[1]).not.toMatch(/[^\x20-\x7e]/); // pure ASCII
    expect(asciiMatch?.[1]).not.toMatch(/["/]/); // filesystem-unsafe chars stripped

    // RFC 5987 UTF-8 variant: present, percent-encodes the accented/emoji
    // characters, and still carries the .pdf extension.
    expect(cd).toContain("filename*=UTF-8''");
    const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)$/);
    expect(utf8Match).not.toBeNull();
    const decoded = decodeURIComponent(utf8Match![1]);
    expect(decoded).toBe(`${NON_ASCII_NAME}.pdf`);
  });

  it('export.csv (same helper, unchanged behavior per the WI-018 regression AC) produces the equivalent dual filename with a .csv extension', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${GROUP_ID}/export.csv`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const cd = disposition(res);

    expect(cd).toMatch(/filename="[^"]*\.csv"/);
    expect(cd).toContain("filename*=UTF-8''");
    const utf8Match = cd.match(/filename\*=UTF-8''([^;]+)$/);
    expect(utf8Match).not.toBeNull();
    expect(decodeURIComponent(utf8Match![1])).toBe(`${NON_ASCII_NAME}.csv`);

    // The two routes' ASCII fallback prefix must agree (same source name,
    // same stripping rule) — only the extension differs.
    const pdfRes = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${GROUP_ID}/export.pdf`,
      headers: { authorization: `Bearer ${token}` },
    });
    const pdfAscii = disposition(pdfRes).match(/filename="([^"]*)\.pdf"/)?.[1];
    const csvAscii = cd.match(/filename="([^"]*)\.csv"/)?.[1];
    expect(pdfAscii).toBe(csvAscii);
  });
});
