import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { buildGroupPdfTable, COLOR_NEGATIVE, COLOR_POSITIVE } from '../src/lib/pdf';
import * as pdfLib from '../src/lib/pdf';
import { buildGroupXlsx } from '../src/lib/xlsx';
import type { CsvExpenseRow, CsvGroup, CsvMember, CsvSettlementRow } from '../src/lib/csv';

// Same fixture as csv-export.test.ts / pdf-export.test.ts (kept independently
// duplicated per-file, per this repo's convention), used to assert data parity
// across all three export formats per spec-WI-030 §4.
const group: CsvGroup = { name: 'Trip to Kuwait' };
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

const FILL_POSITIVE = 'FF006300';
const FILL_NEGATIVE = 'FFD03B3B';

async function loadWorkbook(buf: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return workbook;
}

function fillArgb(cell: ExcelJS.Cell): string | undefined {
  const fill = cell.fill as ExcelJS.FillPattern | undefined;
  if (!fill || fill.type !== 'pattern') return undefined;
  const fg = fill.fgColor as { argb?: string } | undefined;
  return fg?.argb;
}

describe('buildGroupXlsx (spec-WI-030)', () => {
  it('produces a valid, loadable .xlsx buffer (no corruption, no text decode of the output stream)', async () => {
    const buf = await buildGroupXlsx(group, members, expenses, settlements);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(100);
    // Genuine xlsx = a zip archive; PK is the zip local-file-header magic.
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
    const workbook = await loadWorkbook(buf);
    expect(workbook.worksheets.length).toBe(1);
  });

  it('names the worksheet from the group name, sanitized to Excel constraints', async () => {
    const buf = await buildGroupXlsx({ name: 'Trip: Kuwait/Oman [2026]?' }, members, [], []);
    const workbook = await loadWorkbook(buf);
    // No invalid Excel sheet-name characters ([ ] : * ? / \) remain.
    expect(workbook.worksheets[0].name).not.toMatch(/[[\]:*?/\\]/);
    expect(workbook.worksheets[0].name).toBe('Trip KuwaitOman 2026');
  });

  it('falls back to "Ledger" when the sanitized group name is empty', async () => {
    const buf = await buildGroupXlsx({ name: '[]:*?/\\' }, members, [], []);
    const workbook = await loadWorkbook(buf);
    expect(workbook.worksheets[0].name).toBe('Ledger');
  });

  it('truncates a long group name to 31 characters for the sheet name', async () => {
    const longName = 'A'.repeat(50);
    const buf = await buildGroupXlsx({ name: longName }, members, [], []);
    const workbook = await loadWorkbook(buf);
    expect(workbook.worksheets[0].name.length).toBeLessThanOrEqual(31);
  });

  it('mirrors buildGroupPdfTable\'s header exactly', async () => {
    const { header } = buildGroupPdfTable(members, expenses, settlements);
    const buf = await buildGroupXlsx(group, members, expenses, settlements);
    const workbook = await loadWorkbook(buf);
    const sheet = workbook.worksheets[0];
    const headerRow = sheet.getRow(1);
    const actualHeader = header.map((_, i) => String(headerRow.getCell(i + 1).value ?? ''));
    expect(actualHeader).toEqual(header);
  });

  it('writes numeric cells as real numbers derived from the same decimalString source as CSV/PDF, with currency-correct numFmt', async () => {
    const buf = await buildGroupXlsx(group, members, expenses, settlements);
    const workbook = await loadWorkbook(buf);
    const sheet = workbook.worksheets[0];

    // Row 2 = first expense (Dinner, KWD 12.340, Ana +6.170, Sam -6.170).
    const row2 = sheet.getRow(2);
    expect(row2.getCell(5).value).toBe(12.34); // Amount
    expect(row2.getCell(5).numFmt).toBe('0.000'); // KWD has 3 decimals
    expect(row2.getCell(8).value).toBe(6.17); // Ana net
    expect(row2.getCell(9).value).toBe(-6.17); // Sam net

    // Row 3 = second expense (Taxi, JPY 1500, Ana -750, Sam +750) — 0-decimal currency.
    const row3 = sheet.getRow(3);
    expect(row3.getCell(5).value).toBe(1500);
    expect(row3.getCell(5).numFmt).toBe('0');
    expect(row3.getCell(8).value).toBe(-750);
    expect(row3.getCell(9).value).toBe(750);
  });

  it('writes text cells (Date/Description/Category/Currency/Paid by/Split type) as plain strings matching CSV/PDF', async () => {
    const buf = await buildGroupXlsx(group, members, expenses, settlements);
    const workbook = await loadWorkbook(buf);
    const row2 = workbook.worksheets[0].getRow(2);
    expect(row2.getCell(1).value).toBe('2026-01-05');
    expect(row2.getCell(2).value).toBe('Dinner');
    expect(row2.getCell(3).value).toBe('FOOD_DRINK');
    expect(row2.getCell(4).value).toBe('KWD');
    expect(row2.getCell(6).value).toBe('Ana');
    expect(row2.getCell(7).value).toBe('EQUAL');
  });

  it('frames settlement rows identically to CSV/PDF', async () => {
    const buf = await buildGroupXlsx(group, members, [], settlements);
    const workbook = await loadWorkbook(buf);
    const row2 = workbook.worksheets[0].getRow(2);
    expect(row2.getCell(2).value).toBe('Settlement: Ana → Sam');
    expect(row2.getCell(5).value).toBe(6.17);
    expect(row2.getCell(8).value).toBe(6.17); // Ana (from) +amount
    expect(row2.getCell(9).value).toBe(-6.17); // Sam (to) -amount
  });

  it('colors positive per-row member net cells green and negative ones red; zero gets no fill', async () => {
    const buf = await buildGroupXlsx(group, members, expenses, settlements);
    const workbook = await loadWorkbook(buf);
    const row2 = workbook.worksheets[0].getRow(2); // Ana +6.170 (green), Sam -6.170 (red)
    expect(fillArgb(row2.getCell(8))).toBe(FILL_POSITIVE);
    expect(fillArgb(row2.getCell(9))).toBe(FILL_NEGATIVE);
  });

  it('applies no fill to a zero-net member cell', async () => {
    const zeroExpenses: CsvExpenseRow[] = [
      {
        date: new Date('2026-02-01T00:00:00Z'),
        description: 'Even',
        category: 'FOOD_DRINK',
        currency: 'USD',
        amount: 2000,
        splitType: 'EQUAL',
        payers: [
          { userId: 'u1', name: 'Ana', amount: 1000 },
          { userId: 'u2', name: 'Sam', amount: 1000 },
        ],
        splits: [
          { userId: 'u1', amount: 1000 },
          { userId: 'u2', amount: 1000 },
        ],
      },
    ];
    const buf = await buildGroupXlsx(group, members, zeroExpenses, []);
    const workbook = await loadWorkbook(buf);
    const row2 = workbook.worksheets[0].getRow(2);
    expect(row2.getCell(8).value).toBe(0);
    expect(fillArgb(row2.getCell(8))).toBeUndefined();
    expect(row2.getCell(9).value).toBe(0);
    expect(fillArgb(row2.getCell(9))).toBeUndefined();
  });

  it('never mixes/converts currencies (each row keeps its own native currency)', async () => {
    const buf = await buildGroupXlsx(group, members, expenses, settlements);
    const workbook = await loadWorkbook(buf);
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(2).getCell(4).value).toBe('KWD');
    expect(sheet.getRow(3).getCell(4).value).toBe('JPY');
    expect(sheet.getRow(4).getCell(4).value).toBe('KWD');
  });

  it('appends a balance-summary block (Member | Currency | Net | Direction) with colored Net cells, plus a Total outstanding row per currency', async () => {
    const buf = await buildGroupXlsx(group, members, expenses, settlements);
    const workbook = await loadWorkbook(buf);
    const sheet = workbook.worksheets[0];

    const values: string[][] = [];
    sheet.eachRow((row) => {
      values.push(row.values as unknown as string[]);
    });
    const flat = values.map((r) => r.filter((v) => v !== undefined).join('|'));

    expect(flat.some((r) => r.includes('Balance summary'))).toBe(true);
    expect(flat.some((r) => r.includes('Member') && r.includes('Currency') && r.includes('Net') && r.includes('Direction'))).toBe(
      true,
    );

    // Locate the Ana/KWD summary row (owed to them, +12.340) and check its Net cell fill.
    let anaKwdRow: ExcelJS.Row | undefined;
    sheet.eachRow((row) => {
      if (row.getCell(1).value === 'Ana' && row.getCell(2).value === 'KWD' && typeof row.getCell(3).value === 'number') {
        anaKwdRow = row;
      }
    });
    expect(anaKwdRow).toBeDefined();
    expect(anaKwdRow!.getCell(3).value).toBe(12.34);
    expect(anaKwdRow!.getCell(4).value).toBe('owed to them');
    expect(fillArgb(anaKwdRow!.getCell(3))).toBe(FILL_POSITIVE);

    expect(flat.some((r) => r.includes('Total outstanding') && r.includes('KWD'))).toBe(true);
    expect(flat.some((r) => r.includes('Total outstanding') && r.includes('JPY'))).toBe(true);
  });

  it('renders "All members are settled up" for an empty group, still a valid, openable workbook', async () => {
    const buf = await buildGroupXlsx(group, members, [], []);
    const workbook = await loadWorkbook(buf);
    const sheet = workbook.worksheets[0];
    let found = false;
    sheet.eachRow((row) => {
      if (String(row.getCell(1).value ?? '').includes('All members are settled up')) found = true;
    });
    expect(found).toBe(true);
    // Header row still present with no body rows.
    expect(sheet.getRow(1).getCell(1).value).toBe('Date');
  });

  it('numeric parity: xlsx cell values equal buildGroupPdfTable\'s string cells (parsed), row for row', async () => {
    const { rows } = buildGroupPdfTable(members, expenses, settlements);
    const buf = await buildGroupXlsx(group, members, expenses, settlements);
    const workbook = await loadWorkbook(buf);
    const sheet = workbook.worksheets[0];

    for (let r = 0; r < rows.length; r++) {
      const sheetRow = sheet.getRow(r + 2); // +1 for header, +1 for 1-indexing
      for (let c = 0; c < rows[r].length; c++) {
        const cell = sheetRow.getCell(c + 1);
        if (c === 4 || c >= 7) {
          expect(cell.value).toBe(Number(rows[r][c]));
        } else {
          expect(cell.value).toBe(rows[r][c]);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// spec-WI-072 §4 / story regression-test requirement (c) — event-loop
// yielding was added inside buildGroupXlsx's per-row loop (shares
// `yieldToEventLoop`/CHUNK_ROWS = 50 with pdf.ts, per the spec's "shared, not
// duplicated" recommendation). Same coverage shape as pdf-export.test.ts's
// equivalent block: row-order preservation at scale, yield-count precision,
// the empty-group case, and a determinism check for two renders of identical
// input in the current code (no "before" snapshot exists to diff against).
// ---------------------------------------------------------------------------

const CHUNK_ROWS = 50; // mirrors apps/api/src/lib/xlsx.ts's own CHUNK_ROWS constant

/** `count` chronologically-ordered, uniquely-labeled expenses (index in the description). */
function manyExpensesFixture(count: number): CsvExpenseRow[] {
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, 1, 0, i)),
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

describe('buildGroupXlsx — chunked rendering at scale (spec-WI-072 §4)', () => {
  it('preserves exact row order for a large fixture spanning 3 chunk boundaries (150 rows = 3 x CHUNK_ROWS) — no reorder, skip, or duplicate', async () => {
    const manyExpenses = manyExpensesFixture(100);
    const manySettlements = manySettlementsFixture(50);

    const buf = await buildGroupXlsx(group, members, manyExpenses, manySettlements);
    const workbook = await loadWorkbook(buf);
    const sheet = workbook.worksheets[0];

    const expectedDescriptions = [
      ...manyExpenses.map((_, i) => `Expense ${i}`),
      ...manySettlements.map((_, i) => `Settlement: Ana → Recipient${i}`),
    ];
    for (let r = 0; r < expectedDescriptions.length; r++) {
      // row 1 = header, so data row r is sheet row r+2.
      expect(sheet.getRow(r + 2).getCell(2).value).toBe(expectedDescriptions[r]);
    }
  });

  it('yields the event loop exactly Math.floor(rowCount / CHUNK_ROWS) times for a large render, and never for a fixture under CHUNK_ROWS rows', async () => {
    // xlsx.ts imports `yieldToEventLoop` from pdf.ts (spec's "shared, not
    // duplicated" recommendation) — a genuine cross-module reference, so
    // spying on the pdf.ts namespace export correctly observes every call
    // xlsx.ts makes through it (confirmed empirically; this differs from
    // pdf.ts's OWN same-module self-call, where this same technique does not
    // intercept — see pdf-export.test.ts's note). Spying on `setImmediate`
    // directly (the alternative used in pdf-export.test.ts) does not work
    // here: ExcelJS's own `workbook.xlsx.writeBuffer()` internally schedules
    // many unrelated `setImmediate` calls of its own (confirmed empirically),
    // so it isn't a clean proxy for this story's added yields in this file.
    const yieldSpy = vi.spyOn(pdfLib, 'yieldToEventLoop');

    // Small/typical fixture (this file's shared 3-row fixture) — well under
    // CHUNK_ROWS, per spec's "free for the many" property.
    await buildGroupXlsx(group, members, expenses, settlements);
    expect(yieldSpy).not.toHaveBeenCalled();
    yieldSpy.mockClear();

    // 150 rows = exactly 3 x CHUNK_ROWS -> idx 49/99/149 trip the
    // `idx % CHUNK_ROWS === CHUNK_ROWS - 1` condition -> 3 yields.
    const manyExpenses = manyExpensesFixture(150);
    await buildGroupXlsx(group, members, manyExpenses, []);
    expect(yieldSpy).toHaveBeenCalledTimes(3);
    yieldSpy.mockClear();

    // One row under a chunk boundary (149 rows) -> idx 49/99 only -> 2 yields.
    const almostThreeChunks = manyExpensesFixture(149);
    await buildGroupXlsx(group, members, almostThreeChunks, []);
    expect(yieldSpy).toHaveBeenCalledTimes(2);

    yieldSpy.mockRestore();
  });

  it('renders the empty-group case identically regardless of the chunking change (zero rows -> zero yields, unchanged "All members are settled up" text)', async () => {
    const yieldSpy = vi.spyOn(pdfLib, 'yieldToEventLoop');
    const buf = await buildGroupXlsx(group, members, [], []);
    const workbook = await loadWorkbook(buf);
    expect(workbook.worksheets[0].getRow(1).getCell(1).value).toBe('Date');
    expect(yieldSpy).not.toHaveBeenCalled();
    yieldSpy.mockRestore();
  });

  it('determinism: two renders of the IDENTICAL large input in the current (chunked) code produce structurally identical cell data (raw-byte comparison is unreliable here because ExcelJS stamps a wall-clock created/modified timestamp on every new Workbook())', async () => {
    const manyExpenses = manyExpensesFixture(120);
    const manySettlements = manySettlementsFixture(30);

    const buf1 = await buildGroupXlsx(group, members, manyExpenses, manySettlements);
    const buf2 = await buildGroupXlsx(group, members, manyExpenses, manySettlements);
    const wb1 = await loadWorkbook(buf1);
    const wb2 = await loadWorkbook(buf2);
    const sheet1 = wb1.worksheets[0];
    const sheet2 = wb2.worksheets[0];

    expect(sheet1.rowCount).toBe(sheet2.rowCount);
    for (let r = 1; r <= sheet1.rowCount; r++) {
      const row1 = sheet1.getRow(r).values as unknown[];
      const row2 = sheet2.getRow(r).values as unknown[];
      expect(row1).toEqual(row2);
    }
  });

  it('page/row structure is unaffected by however many chunk yields occur (many-row fixture still has header + every data row + the balance-summary block)', async () => {
    const manyExpenses = manyExpensesFixture(150);
    const buf = await buildGroupXlsx(group, members, manyExpenses, []);
    const workbook = await loadWorkbook(buf);
    const sheet = workbook.worksheets[0];
    // header + 150 data rows + blank + "Balance summary" + summary header + >=1 summary line + total = at least 155 rows.
    expect(sheet.rowCount).toBeGreaterThanOrEqual(155);
    let found = false;
    sheet.eachRow((row) => {
      if (String(row.getCell(1).value ?? '').includes('Balance summary')) found = true;
    });
    expect(found).toBe(true);
  });
});
