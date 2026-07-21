import ExcelJS from 'exceljs';
import { getCurrency } from '@divzy/shared';
import { decimalString } from './money-format';
import type { CsvExpenseRow, CsvGroup, CsvMember, CsvSettlementRow } from './csv';
import {
  buildGroupPdfTable,
  computeBalanceSummary,
  isNumericColumn,
  yieldToEventLoop,
  COLOR_NEGATIVE,
  COLOR_POSITIVE,
  type BalanceSummaryLine,
} from './pdf';

// ---------------------------------------------------------------------------
// Group .xlsx export (spec-WI-030 / ADR-023) — the color-capable analogue of
// csv.ts's buildGroupCsv and pdf.ts's buildGroupPdf. Same input shapes
// (CsvGroup/CsvMember/CsvExpenseRow/CsvSettlementRow) and the same table
// derivation: this reuses `buildGroupPdfTable` directly (never a second
// paid-minus-owed computation) so the three export formats cannot drift on
// values or ordering, and `computeBalanceSummary` for the balance-summary
// block (never a second `computeNets`). Numeric cell values are
// `Number(decimalString(...))` — parsed straight out of buildGroupPdfTable's
// already-`decimalString`-formatted strings, the single rounding source
// shared with CSV/PDF. Real cell fills (green/red, reusing pdf.ts's
// COLOR_POSITIVE/COLOR_NEGATIVE, converted to ARGB) go on both the
// balance-summary Net cells and the per-row member net cells; a zero net gets
// no fill (never color-only). Output: `workbook.xlsx.writeBuffer()` -> Buffer,
// with no `.toString()`/text decode of the output bytes anywhere (WI-018-style
// binary integrity guard).
// ---------------------------------------------------------------------------

/** Hex `#rrggbb` -> exceljs ARGB (`FFrrggbb`), opaque alpha. No new colors — only pdf.ts's constants are ever passed in. */
function argb(hex: string): string {
  return `FF${hex.slice(1).toUpperCase()}`;
}

const FILL_POSITIVE = argb(COLOR_POSITIVE);
const FILL_NEGATIVE = argb(COLOR_NEGATIVE);
const WHITE_BOLD_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFFFF' }, bold: true };

/** Rows per event-loop yield in the main row loop (spec-WI-072 §4). Small/
 *  typical groups (<=50 rows) never hit this and see zero behavior change. */
const CHUNK_ROWS = 50;

/** Excel numeric display format for a currency's decimal count (`'0'`, `'0.00'`, `'0.000'`). */
function numFmtFor(decimals: number): string {
  return decimals === 0 ? '0' : `0.${'0'.repeat(decimals)}`;
}

/**
 * Sanitize a group name into a valid Excel worksheet name: strip the
 * characters Excel forbids in sheet names (`[ ] : * ? / \`), truncate to
 * Excel's 31-character limit, and fall back to `"Ledger"` if nothing usable
 * remains.
 */
function sanitizeSheetName(name: string): string {
  const stripped = name.replace(/[[\]:*?/\\]/g, '').trim();
  return stripped.slice(0, 31) || 'Ledger';
}

/** Fills `cell` green/red for a positive/negative net (white bold font for contrast); zero net gets no fill. */
function applyNetFill(cell: ExcelJS.Cell, net: number): void {
  if (net > 0) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_POSITIVE } };
    cell.font = WHITE_BOLD_FONT;
  } else if (net < 0) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_NEGATIVE } };
    cell.font = WHITE_BOLD_FONT;
  }
}

/** ADR-021 direction label, matching csv.ts's/pdf.ts's wording (independently mapped per format, same convention). */
function directionLabel(status: BalanceSummaryLine['status']): string {
  if (status === 'owed') return 'owed to them';
  if (status === 'owes') return 'they owe';
  return 'settled up';
}

/**
 * Build the `.xlsx` workbook buffer for one group. Mirrors buildGroupCsv's/
 * buildGroupPdf's data exactly (via buildGroupPdfTable + computeBalanceSummary)
 * with real cell fills instead of a text-only signal. Empty group -> header +
 * no body rows, plus a "settled up" balance summary — never an error.
 */
export async function buildGroupXlsx(
  group: CsvGroup,
  members: CsvMember[],
  expenses: CsvExpenseRow[],
  settlements: CsvSettlementRow[],
): Promise<Buffer> {
  const { header, rows } = buildGroupPdfTable(members, expenses, settlements);
  const summary = computeBalanceSummary(members, expenses, settlements);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sanitizeSheetName(group.name));

  const headerRow = sheet.addRow(header);
  headerRow.font = { bold: true };

  for (const [idx, row] of rows.entries()) {
    const currency = row[3];
    const numFmt = numFmtFor(getCurrency(currency).decimals);
    const values: Array<string | number> = row.map((cellText, i) =>
      isNumericColumn(i) ? Number(cellText) : cellText,
    );
    const sheetRow = sheet.addRow(values);
    for (let i = 0; i < row.length; i++) {
      if (!isNumericColumn(i)) continue;
      const cell = sheetRow.getCell(i + 1); // exceljs columns are 1-indexed
      cell.numFmt = numFmt;
      if (i >= 7) applyNetFill(cell, Number(row[i]));
    }
    if (idx % CHUNK_ROWS === CHUNK_ROWS - 1) await yieldToEventLoop();
  }

  // -- Balance summary (ADR-021, shared computation with pdf.ts) --------------
  sheet.addRow([]);
  sheet.addRow(['Balance summary']);
  const summaryHeaderRow = sheet.addRow(['Member', 'Currency', 'Net', 'Direction']);
  summaryHeaderRow.font = { bold: true };

  if (summary.length === 0) {
    sheet.addRow(['All members are settled up.']);
  } else {
    for (const currencySummary of summary) {
      const numFmt = numFmtFor(getCurrency(currencySummary.currency).decimals);
      for (const line of currencySummary.lines) {
        const netValue = Number(decimalString(line.net, line.currency));
        const row = sheet.addRow([line.memberName, line.currency, netValue, directionLabel(line.status)]);
        const netCell = row.getCell(3);
        netCell.numFmt = numFmt;
        applyNetFill(netCell, line.net);
      }
      const totalValue = Number(decimalString(currencySummary.totalOutstanding, currencySummary.currency));
      const totalRow = sheet.addRow(['Total outstanding', currencySummary.currency, totalValue]);
      totalRow.getCell(3).numFmt = numFmt;
    }
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}
