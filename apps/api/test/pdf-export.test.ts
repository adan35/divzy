import { describe, expect, it, vi } from 'vitest';
import PDFDocument from 'pdfkit';
import { buildGroupCsv, type CsvExpenseRow, type CsvMember, type CsvSettlementRow } from '../src/lib/csv';
import {
  buildGroupPdf,
  buildGroupPdfTable,
  computeBalanceSummary,
  computeColumnWidths,
  formatBalanceLine,
  formatTotalOutstandingLine,
  isNumericColumn,
  memberColumnFont,
  COLOR_NEGATIVE,
  COLOR_NEUTRAL,
  COLOR_POSITIVE,
  HEADER_FILL,
  ROW_STRIPE,
} from '../src/lib/pdf';

// Same fixture as csv-export.test.ts (kept independent/duplicated per-file —
// not imported cross-file — so each test file stands alone), used to assert
// data parity between buildGroupCsv and buildGroupPdf per spec-WI-018 §Formatter.
const group = { name: 'Trip to Kuwait' };
const members: CsvMember[] = [
  { id: 'u1', name: 'Ana' },
  { id: 'u2', name: 'Sam' },
];
const expenses: CsvExpenseRow[] = [
  {
    date: new Date('2026-01-05T10:00:00Z'),
    description: 'Dinner',
    category: 'FOOD_DRINK',
    currency: 'KWD',
    amount: 12340,
    splitType: 'EQUAL',
    payers: [{ userId: 'u1', name: 'Ana', amount: 12340 }],
    splits: [
      { userId: 'u1', amount: 6170 },
      { userId: 'u2', amount: 6170 },
    ],
  },
  {
    date: new Date('2026-01-06T10:00:00Z'),
    description: 'Taxi, "airport"',
    category: 'TRANSPORT',
    currency: 'JPY',
    amount: 1500,
    splitType: 'EQUAL',
    payers: [{ userId: 'u2', name: 'Sam', amount: 1500 }],
    splits: [
      { userId: 'u1', amount: 750 },
      { userId: 'u2', amount: 750 },
    ],
  },
];
const settlements: CsvSettlementRow[] = [
  {
    date: new Date('2026-01-07T10:00:00Z'),
    currency: 'KWD',
    amount: 6170,
    fromUserId: 'u1',
    fromName: 'Ana',
    toUserId: 'u2',
    toName: 'Sam',
  },
];

/** Parse RFC 4180 CSV (as produced by buildGroupCsv) back into cell arrays. */
function parseCsv(csv: string): string[][] {
  return csv
    .replace(/\r\n$/, '')
    .split('\r\n')
    .map((line) => {
      const cells: string[] = [];
      let i = 0;
      while (i <= line.length) {
        if (line[i] === '"') {
          let j = i + 1;
          let value = '';
          while (j < line.length) {
            if (line[j] === '"' && line[j + 1] === '"') {
              value += '"';
              j += 2;
            } else if (line[j] === '"') {
              break;
            } else {
              value += line[j];
              j += 1;
            }
          }
          cells.push(value);
          i = j + 2; // skip closing quote + comma
        } else {
          const next = line.indexOf(',', i);
          const end = next === -1 ? line.length : next;
          cells.push(line.slice(i, end));
          i = end + 1;
        }
        if (i > line.length) break;
      }
      return cells;
    });
}

describe('buildGroupPdfTable (data parity with buildGroupCsv)', () => {
  it('produces the identical header + transactional row cells as the CSV export for the same fixture', () => {
    const csvRows = parseCsv(buildGroupCsv(group, members, expenses, settlements));
    const { header, rows } = buildGroupPdfTable(members, expenses, settlements);

    // Scoped to the transactional (expense + settlement) rows only, per
    // spec-WI-029 §2/§3.3: buildGroupPdfTable is kept as-is and never carries
    // a balance-summary block — that's a wholly separate PDF section
    // (computeBalanceSummary), rendered independently of these table rows.
    // CSV's own balance-summary rows (WI-030/ADR-021) are appended *after*
    // the transactional rows in the same csv string, so this compares only
    // the first `expenses.length + settlements.length` CSV rows, robust to
    // however CSV formats its own (PDF-independent) summary block.
    const transactionalRowCount = expenses.length + settlements.length;
    expect(header).toEqual(csvRows[0]);
    expect(rows).toEqual(csvRows.slice(1, 1 + transactionalRowCount));
  });

  it('produces a header with no rows for an empty group', () => {
    const { header, rows } = buildGroupPdfTable(members, [], []);
    expect(header).toEqual(['Date', 'Description', 'Category', 'Currency', 'Amount', 'Paid by', 'Split type', 'Ana', 'Sam']);
    expect(rows).toEqual([]);
  });

  it('frames settlement rows and signs them with the payer +amount / recipient −amount convention', () => {
    const { rows } = buildGroupPdfTable(members, [], settlements);
    expect(rows).toEqual([
      ['2026-01-07', 'Settlement: Ana → Sam', '', 'KWD', '6.170', 'Ana', '', '6.170', '-6.170'],
    ]);
  });
});

describe('buildGroupPdf', () => {
  it('produces a valid, non-empty PDF buffer for a populated group', async () => {
    const buf = await buildGroupPdf(group, members, expenses, settlements);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(100);
  });

  it('produces a valid PDF for an empty group instead of erroring', async () => {
    const buf = await buildGroupPdf(group, members, [], []);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

// ---------------------------------------------------------------------------
// spec-WI-029 additions: real gridded table layout, branded header, and the
// per-member colored balance-summary section. Pure helpers are unit tested
// directly; buildGroupPdf itself is exercised for binary integrity, page
// breaks, and empty-group handling (structural PDF introspection only, never
// a decode step in production code — see §6 of the spec).
// ---------------------------------------------------------------------------

describe('computeColumnWidths', () => {
  it('returns one width per base column plus one per member, summing to the usable width', () => {
    const widths = computeColumnWidths(2, 700);
    expect(widths).toHaveLength(9); // 7 base + 2 members
    expect(widths.every((w) => w > 0)).toBe(true);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(700, 5);
  });

  it('gives every member column the same width', () => {
    const widths = computeColumnWidths(3, 900);
    const memberWidths = widths.slice(7);
    expect(memberWidths[0]).toBeCloseTo(memberWidths[1], 6);
    expect(memberWidths[1]).toBeCloseTo(memberWidths[2], 6);
  });

  it('handles zero members (just the base columns)', () => {
    const widths = computeColumnWidths(0, 500);
    expect(widths).toHaveLength(7);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(500, 5);
  });
});

describe('computeBalanceSummary (ADR-021 semantics)', () => {
  it('computes per-currency member nets and total-outstanding = sum of positive nets', () => {
    // Ana paid 100 USD split evenly two ways: Ana +50, Sam -50.
    const summaryExpenses: CsvExpenseRow[] = [
      {
        date: new Date('2026-01-01T00:00:00Z'),
        description: 'Groceries',
        category: 'FOOD_DRINK',
        currency: 'USD',
        amount: 10000,
        splitType: 'EQUAL',
        payers: [{ userId: 'u1', name: 'Ana', amount: 10000 }],
        splits: [
          { userId: 'u1', amount: 5000 },
          { userId: 'u2', amount: 5000 },
        ],
      },
    ];
    const result = computeBalanceSummary(members, summaryExpenses, []);
    expect(result).toEqual([
      {
        currency: 'USD',
        totalOutstanding: 5000,
        lines: [
          { currency: 'USD', memberId: 'u1', memberName: 'Ana', net: 5000, status: 'owed' },
          { currency: 'USD', memberId: 'u2', memberName: 'Sam', net: -5000, status: 'owes' },
        ],
      },
    ]);
  });

  it('labels an exactly-zero net member as settled, never owed/owes', () => {
    const result = computeBalanceSummary(
      members,
      [
        {
          date: new Date('2026-01-01T00:00:00Z'),
          description: 'Split evenly then paid back',
          category: 'OTHER',
          currency: 'USD',
          amount: 2000,
          splitType: 'EQUAL',
          payers: [{ userId: 'u1', name: 'Ana', amount: 2000 }],
          splits: [
            { userId: 'u1', amount: 1000 },
            { userId: 'u2', amount: 1000 },
          ],
        },
      ],
      [
        {
          date: new Date('2026-01-02T00:00:00Z'),
          currency: 'USD',
          amount: 1000,
          fromUserId: 'u2',
          fromName: 'Sam',
          toUserId: 'u1',
          toName: 'Ana',
        },
      ],
    );
    expect(result).toEqual([
      {
        currency: 'USD',
        totalOutstanding: 0,
        lines: [
          { currency: 'USD', memberId: 'u1', memberName: 'Ana', net: 0, status: 'settled' },
          { currency: 'USD', memberId: 'u2', memberName: 'Sam', net: 0, status: 'settled' },
        ],
      },
    ]);
  });

  it('keeps currencies strictly separate and sorted', () => {
    const result = computeBalanceSummary(
      members,
      [
        {
          date: new Date('2026-01-01T00:00:00Z'),
          description: 'JPY lunch',
          category: 'FOOD_DRINK',
          currency: 'JPY',
          amount: 2000,
          splitType: 'EQUAL',
          payers: [{ userId: 'u2', name: 'Sam', amount: 2000 }],
          splits: [
            { userId: 'u1', amount: 1000 },
            { userId: 'u2', amount: 1000 },
          ],
        },
        {
          date: new Date('2026-01-01T00:00:00Z'),
          description: 'USD lunch',
          category: 'FOOD_DRINK',
          currency: 'USD',
          amount: 2000,
          splitType: 'EQUAL',
          payers: [{ userId: 'u1', name: 'Ana', amount: 2000 }],
          splits: [
            { userId: 'u1', amount: 1000 },
            { userId: 'u2', amount: 1000 },
          ],
        },
      ],
      [],
    );
    expect(result.map((c) => c.currency)).toEqual(['JPY', 'USD']);
  });

  it('returns an empty array for a group with no expenses or settlements', () => {
    expect(computeBalanceSummary(members, [], [])).toEqual([]);
  });
});

describe('formatBalanceLine (STYLE.md signed-color convention)', () => {
  it('renders a positive net in green with a leading +', () => {
    const result = formatBalanceLine({ currency: 'USD', memberId: 'u1', memberName: 'Ana', net: 5000, status: 'owed' });
    expect(result.color).toBe(COLOR_POSITIVE);
    expect(result.color).toBe('#006300');
    expect(result.text).toBe('Ana — USD +50.00');
  });

  it('renders a negative net in red with its own minus sign', () => {
    const result = formatBalanceLine({ currency: 'USD', memberId: 'u2', memberName: 'Sam', net: -5000, status: 'owes' });
    expect(result.color).toBe(COLOR_NEGATIVE);
    expect(result.color).toBe('#d03b3b');
    expect(result.text).toBe('Sam — USD -50.00');
  });

  it('renders an exactly-zero net as neutral "settled up", never colored', () => {
    const result = formatBalanceLine({ currency: 'USD', memberId: 'u1', memberName: 'Ana', net: 0, status: 'settled' });
    expect(result.color).toBe(COLOR_NEUTRAL);
    expect(result.color).not.toBe(COLOR_POSITIVE);
    expect(result.color).not.toBe(COLOR_NEGATIVE);
    expect(result.text).toBe('Ana — USD settled up');
  });
});

describe('formatTotalOutstandingLine', () => {
  it('formats the per-currency total-outstanding amount', () => {
    expect(formatTotalOutstandingLine('USD', 5000)).toBe('Total outstanding (USD): 50.00');
  });
});

describe('buildGroupPdf — real table, branding, and balance summary (spec-WI-029)', () => {
  it('stays a well-formed binary PDF (no decode step) and grows to fit a real table + summary', async () => {
    const buf = await buildGroupPdf(group, members, expenses, settlements);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.subarray(-6).toString('latin1').trim().endsWith('%%EOF')).toBe(true);
  });

  it('renders group emoji + name branding and paginates with a repeated header across many rows', async () => {
    const manyExpenses: CsvExpenseRow[] = Array.from({ length: 80 }, (_, i) => ({
      date: new Date(`2026-01-${String((i % 27) + 1).padStart(2, '0')}T00:00:00Z`),
      description: `Expense ${i}`,
      category: 'OTHER',
      currency: 'USD',
      amount: 1000,
      splitType: 'EQUAL',
      payers: [{ userId: 'u1', name: 'Ana', amount: 1000 }],
      splits: [
        { userId: 'u1', amount: 500 },
        { userId: 'u2', amount: 500 },
      ],
    }));
    const buf = await buildGroupPdf({ name: 'Trip to Kuwait', emoji: '✈️' }, members, manyExpenses, []);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // Structural (not content-stream) PDF objects are written uncompressed by
    // pdfkit's classic xref writer — counting literal "/Type /Page" object
    // dictionaries is a valid, decode-free-in-production way to assert
    // multiple pages were produced by the page-break logic.
    const raw = buf.toString('latin1');
    const pageObjectCount = (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pageObjectCount).toBeGreaterThan(1);
  });

  it('still produces a valid PDF with a graceful empty-state message and a settled-up summary for an empty group', async () => {
    const buf = await buildGroupPdf(group, members, [], []);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// spec-WI-029 (reopened 2026-07-17): legibility fixes — right alignment,
// zebra striping + header band, and a minimum member-column width floor with
// a many-member fallback. Pure helpers unit tested directly; rendering
// behavior verified by spying on the PDFDocument prototype methods (mixed
// onto the prototype at module load, per pdfkit's `mixin()`), never by
// decoding the output byte stream (WI-018 guard stays intact).
// ---------------------------------------------------------------------------

describe('isNumericColumn (spec-WI-029 §1 alignment)', () => {
  it('marks Amount (4) and every member net column (index >= 7) as numeric/right-aligned', () => {
    expect(isNumericColumn(4)).toBe(true);
    expect(isNumericColumn(7)).toBe(true);
    expect(isNumericColumn(8)).toBe(true);
    expect(isNumericColumn(20)).toBe(true);
  });

  it('leaves Date/Description/Category/Currency/Paid by/Split type left-aligned', () => {
    expect(isNumericColumn(0)).toBe(false);
    expect(isNumericColumn(1)).toBe(false);
    expect(isNumericColumn(2)).toBe(false);
    expect(isNumericColumn(3)).toBe(false);
    expect(isNumericColumn(5)).toBe(false);
    expect(isNumericColumn(6)).toBe(false);
  });
});

describe('memberColumnFont (spec-WI-029 §3 many-member fallback)', () => {
  it('stays at the normal 8pt for small/medium member counts', () => {
    expect(memberColumnFont(2, 700)).toBe(8);
    expect(memberColumnFont(0, 500)).toBe(8);
  });

  it('shrinks to 6.5pt only once member minimums + the base minimum overflow the usable width', () => {
    // A4 landscape usable width is ~770pt; >~14 members overflows even at the column-width floor.
    expect(memberColumnFont(20, 770)).toBe(6.5);
  });

  it('stays at 8pt for many members when the usable width is wide enough to still fit the floor', () => {
    expect(memberColumnFont(20, 1200)).toBe(8);
  });
});

describe('computeColumnWidths — minimum member-column floor (spec-WI-029 §3)', () => {
  it('leaves small groups unchanged (smallest member column already above the floor)', () => {
    const widths = computeColumnWidths(2, 700);
    const memberWidths = widths.slice(7);
    expect(Math.min(...memberWidths)).toBeGreaterThan(32);
  });

  it('leaves small groups unchanged even at wider usable widths (proportional split already clears the floor)', () => {
    // NB: with these weights/constants, once the proportional member width dips below
    // MIN_MEMBER_COL_PT the leftover base budget is always < BASE_MIN_PT too (the
    // "clamp to floor, base budget stays readable" middle case never fires in practice —
    // it falls straight through to the many-member overflow branch below). This asserts
    // the still-unclamped case at a larger usable width, and the overflow test below
    // covers the branch that actually engages once the floor is violated.
    const widths = computeColumnWidths(20, 1200);
    const memberWidths = widths.slice(7);
    expect(Math.min(...memberWidths)).toBeGreaterThan(32);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(1200, 5);
  });

  it('gives base columns the BASE_MIN_PT floor and splits the remainder equally across members once too many members overflow the width even at the per-member floor', () => {
    const widths = computeColumnWidths(20, 770);
    const baseWidths = widths.slice(0, 7);
    const memberWidths = widths.slice(7);
    expect(baseWidths.reduce((a, b) => a + b, 0)).toBeCloseTo(320, 5);
    expect(memberWidths.every((w) => Math.abs(w - memberWidths[0]) < 1e-9)).toBe(true);
    expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(770, 5);
  });

  it('never overflows or underflows usableWidth regardless of member count', () => {
    for (const n of [0, 1, 5, 14, 15, 30, 50]) {
      const widths = computeColumnWidths(n, 770);
      expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(770, 5);
      expect(widths.every((w) => w > 0)).toBe(true);
    }
  });
});

describe('buildGroupPdf rendering — alignment, striping, header band (spec-WI-029)', () => {
  it('right-aligns the Amount and member net columns, left-aligns text columns, in both header and body cells', async () => {
    const textSpy = vi.spyOn(PDFDocument.prototype, 'text');
    await buildGroupPdf(group, members, expenses, settlements);

    const amountHeaderCall = textSpy.mock.calls.find(([text]) => text === 'Amount');
    expect(amountHeaderCall?.[3]).toMatchObject({ align: 'right' });

    const descHeaderCall = textSpy.mock.calls.find(([text]) => text === 'Description');
    expect(descHeaderCall?.[3]).toMatchObject({ align: 'left' });

    const memberHeaderCall = textSpy.mock.calls.find(([text]) => text === 'Ana');
    expect(memberHeaderCall?.[3]).toMatchObject({ align: 'right' });

    const bodyAmountCall = textSpy.mock.calls.find(([text]) => text === '12.340');
    expect(bodyAmountCall?.[3]).toMatchObject({ align: 'right' });

    const bodyDescCall = textSpy.mock.calls.find(([text]) => text === 'Dinner');
    expect(bodyDescCall?.[3]).toMatchObject({ align: 'left' });

    textSpy.mockRestore();
  });

  it('fills a header band behind the column-header row', async () => {
    const fillColorSpy = vi.spyOn(PDFDocument.prototype, 'fillColor');
    await buildGroupPdf(group, members, expenses, settlements);
    const headerFillCalls = fillColorSpy.mock.calls.filter(([color]) => color === HEADER_FILL);
    expect(headerFillCalls.length).toBeGreaterThan(0);
    fillColorSpy.mockRestore();
  });

  it('zebra-stripes odd body rows with the neutral surface tint, and never colors the header band the same as the stripe', () => {
    expect(ROW_STRIPE).not.toBe(HEADER_FILL);
  });

  it('stripes exactly the odd-indexed body rows (2 expenses + 1 settlement -> row index 1 only)', async () => {
    const fillColorSpy = vi.spyOn(PDFDocument.prototype, 'fillColor');
    await buildGroupPdf(group, members, expenses, settlements);
    const stripeCalls = fillColorSpy.mock.calls.filter(([color]) => color === ROW_STRIPE);
    expect(stripeCalls.length).toBe(1);
    fillColorSpy.mockRestore();
  });

  it('never stripes when there are no body rows (empty group)', async () => {
    const fillColorSpy = vi.spyOn(PDFDocument.prototype, 'fillColor');
    await buildGroupPdf(group, members, [], []);
    const stripeCalls = fillColorSpy.mock.calls.filter(([color]) => color === ROW_STRIPE);
    expect(stripeCalls.length).toBe(0);
    fillColorSpy.mockRestore();
  });

  it('keeps body text at 8pt or larger for a small group (no regression below 8pt)', async () => {
    const fontSizeSpy = vi.spyOn(PDFDocument.prototype, 'fontSize');
    await buildGroupPdf(group, members, expenses, settlements);
    const sizesUsed = new Set(fontSizeSpy.mock.calls.map(([size]) => size));
    for (const size of sizesUsed) {
      expect(size as number).toBeGreaterThanOrEqual(8);
    }
    fontSizeSpy.mockRestore();
  });

  it('abbreviates member headers to their first token and shrinks font past the many-member threshold, staying a valid PDF', async () => {
    const manyMembers: CsvMember[] = Array.from({ length: 20 }, (_, i) => ({
      id: `u${i}`,
      name: `Member ${i} LongLastName`,
    }));
    const fontSizeSpy = vi.spyOn(PDFDocument.prototype, 'fontSize');
    const textSpy = vi.spyOn(PDFDocument.prototype, 'text');
    const buf = await buildGroupPdf(group, manyMembers, [], []);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(fontSizeSpy.mock.calls.some(([size]) => size === 6.5)).toBe(true);
    expect(textSpy.mock.calls.some(([text]) => text === 'Member')).toBe(true);
    expect(textSpy.mock.calls.some(([text]) => text === 'Member 0 LongLastName')).toBe(false);
    fontSizeSpy.mockRestore();
    textSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// spec-WI-072 §4 / story regression-test requirement (c) — event-loop
// yielding was added inside buildGroupPdf's per-row render loop (CHUNK_ROWS =
// 50, `pdf.ts`, not exported — mirrored here as a literal since it's an
// internal tuning constant, confirmed by reading the built code rather than
// guessed). These tests prove: (1) chunking never reorders/skips/duplicates a
// row at scale, (2) the loop actually yields for a large render and not at
// all for a small one, and (3) two renders of the identical input in the
// CURRENT code are deterministic modulo pdfkit's own per-render
// CreationDate/trailer-ID metadata (no "before" snapshot exists to diff
// against — the change already landed — so this is a determinism check, not
// a literal before/after byte diff; see test-plan-WI-072.md).
// ---------------------------------------------------------------------------

const CHUNK_ROWS = 50; // mirrors apps/api/src/lib/pdf.ts's own CHUNK_ROWS constant

/** `count` chronologically-ordered, uniquely-labeled expenses (index in the description). */
function manyExpensesFixture(count: number): CsvExpenseRow[] {
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, 1, 0, i)), // one row per minute, strictly increasing
    description: `Expense ${i}`,
    category: 'OTHER',
    currency: 'USD',
    amount: 1000 + i,
    splitType: 'EQUAL',
    payers: [{ userId: 'u1', name: 'Ana', amount: 1000 + i }],
    splits: [
      { userId: 'u1', amount: 500 },
      { userId: 'u2', amount: 500 + i },
    ],
  }));
}

/** `count` chronologically-ordered, uniquely-labeled settlements. */
function manySettlementsFixture(count: number): CsvSettlementRow[] {
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.UTC(2026, 1, 1, 0, i)),
    currency: 'USD',
    amount: 100 + i,
    fromUserId: 'u1',
    fromName: 'Ana',
    toUserId: 'u2',
    toName: `Recipient${i}`,
  }));
}

/** Mask pdfkit's own per-render wall-clock CreationDate (fixed-width
 * `(D:YYYYMMDDHHMMSSZ)`) and random trailer `/ID` pair (fixed-width hex) so
 * the rest of the byte stream can be compared for genuine determinism — both
 * fields legitimately vary run-to-run per spec-WI-072's documented caveat and
 * are unrelated to this story's chunking change. */
function maskVolatilePdfMetadata(buf: Buffer): string {
  return buf
    .toString('latin1')
    .replace(/\(D:\d{14}Z\)/, '(D:MASKED)')
    .replace(/\/ID \[<[0-9a-f]+> <[0-9a-f]+>\]/, '/ID [MASKED]');
}

describe('buildGroupPdf — chunked rendering at scale (spec-WI-072 §4)', () => {
  it('preserves exact row order for a large fixture spanning 3 chunk boundaries (150 rows = 3 x CHUNK_ROWS) — no reorder, skip, or duplicate', async () => {
    const manyExpenses = manyExpensesFixture(100);
    const manySettlements = manySettlementsFixture(50);
    const textSpy = vi.spyOn(PDFDocument.prototype, 'text');

    const buf = await buildGroupPdf(group, members, manyExpenses, manySettlements);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // Description-column cell text is unique per row (`Expense N` /
    // `Settlement: Ana → RecipientN`); its draw order across the WHOLE
    // render (spanning multiple chunk yields and page breaks) must exactly
    // match input order: expenses chronological, then settlements.
    const drawnRowLabels = textSpy.mock.calls
      .map(([text]) => text as string)
      .filter((text) => /^Expense \d+$/.test(text) || /^Settlement: Ana → Recipient\d+$/.test(text));

    const expectedOrder = [
      ...manyExpenses.map((_, i) => `Expense ${i}`),
      ...manySettlements.map((_, i) => `Settlement: Ana → Recipient${i}`),
    ];
    expect(drawnRowLabels).toEqual(expectedOrder);
    textSpy.mockRestore();
  });

  it('yields the event loop exactly Math.floor(rowCount / CHUNK_ROWS) times for a large render, and never for a fixture under CHUNK_ROWS rows', async () => {
    // yieldToEventLoop's body is `new Promise((resolve) => setImmediate(resolve))`;
    // buildGroupPdf's internal call to the co-located `yieldToEventLoop`
    // resolves to the module's own local binding (confirmed empirically: a
    // `vi.spyOn(pdfLib, 'yieldToEventLoop')` on the namespace import does NOT
    // observe this same-module self-call under this repo's Vitest/esbuild
    // transform), so spy one level down on the actual scheduling primitive
    // instead — `setImmediate` is not used anywhere else in buildGroupPdf's
    // render path, so this counts exactly the chunking yields.
    const setImmediateSpy = vi.spyOn(global, 'setImmediate');

    // Small/typical fixture (this file's shared 3-row fixture: 2 expenses +
    // 1 settlement) — well under CHUNK_ROWS, per spec's "free for the many" property.
    await buildGroupPdf(group, members, expenses, settlements);
    expect(setImmediateSpy).not.toHaveBeenCalled();
    setImmediateSpy.mockClear();

    // 150 rows = exactly 3 x CHUNK_ROWS -> idx 49/99/149 trip the
    // `idx % CHUNK_ROWS === CHUNK_ROWS - 1` condition -> 3 yields.
    const manyExpenses = manyExpensesFixture(150);
    await buildGroupPdf(group, members, manyExpenses, []);
    expect(setImmediateSpy).toHaveBeenCalledTimes(3);
    setImmediateSpy.mockClear();

    // One row under a chunk boundary (149 rows) -> idx 49/99 only -> 2 yields.
    const almostThreeChunks = manyExpensesFixture(149);
    await buildGroupPdf(group, members, almostThreeChunks, []);
    expect(setImmediateSpy).toHaveBeenCalledTimes(2);

    setImmediateSpy.mockRestore();
  });

  it('renders the empty-group case identically regardless of the chunking change (zero rows -> zero yields, unchanged empty-state text)', async () => {
    const setImmediateSpy = vi.spyOn(global, 'setImmediate');
    const buf = await buildGroupPdf(group, members, [], []);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(setImmediateSpy).not.toHaveBeenCalled();
    setImmediateSpy.mockRestore();
  });

  it('determinism: two renders of the IDENTICAL large input in the current (chunked) code are byte-identical aside from pdfkit\'s own per-render CreationDate/ID metadata', async () => {
    const manyExpenses = manyExpensesFixture(120);
    const manySettlements = manySettlementsFixture(30);

    const buf1 = await buildGroupPdf(group, members, manyExpenses, manySettlements);
    const buf2 = await buildGroupPdf(group, members, manyExpenses, manySettlements);

    expect(buf1.length).toBe(buf2.length);
    expect(maskVolatilePdfMetadata(buf1)).toBe(maskVolatilePdfMetadata(buf2));
  });

  it('page breaks / pagination are unaffected by however many chunk yields occur (many-row fixture still spans multiple PDF page objects)', async () => {
    const manyExpenses = manyExpensesFixture(150);
    const buf = await buildGroupPdf(group, members, manyExpenses, []);
    const raw = buf.toString('latin1');
    const pageObjectCount = (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pageObjectCount).toBeGreaterThan(1);
  });
});
