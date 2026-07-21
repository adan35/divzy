// Ownership note: this artifact is conceptually analytics-owned per the CSV
// export precedent (see settlements charter); implemented under settlements per
// explicit backlog routing, cto-accepted at Design (ADR-014) with the condition
// that analytics review this before/at release. WI-029 redesigns the rendering
// (real table, branding, colored balance summary) per ADR-021 — dataset and
// data-prep step (buildGroupPdfTable) are unchanged.

import PDFDocument from 'pdfkit';
import { computeNets } from '@divzy/shared';
import { decimalString } from './money-format';
import type { CsvExpenseRow, CsvGroup, CsvMember, CsvSettlementRow } from './csv';

// ---------------------------------------------------------------------------
// Group PDF export — the PDF analogue of csv.ts's buildGroupCsv (ADR-014).
// Same input shapes (CsvGroup/CsvMember/CsvExpenseRow/CsvSettlementRow), same
// rules: expenses first in chronological order, then settlement rows framed
// `Settlement: <from> → <to>`; per-active-member net column = paid − owed
// (computeNets sign convention); settlement rows show payer +amount,
// recipient −amount. Amount formatting goes through the shared
// `decimalString` helper (lib/money-format.ts) so CSV and PDF can never
// drift apart on currency-correct decimals.
//
// Rendering (WI-029): a real gridded table (vector rects + clipped/truncated
// cell text), a branded header repeated on every page, and an additive
// per-member balance-summary section using the app's green/red signed-color
// convention (STYLE.md, ADR-021). Binary integrity (WI-018 regression guard):
// pdfkit -> Buffer chunks -> Buffer.concat -> Buffer, end to end. No
// `.text()`/`.toString()` decode of the *output* byte stream anywhere below.
// ---------------------------------------------------------------------------

/** Calendar date part of an ISO timestamp (exports don't need times). */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Yield one event-loop turn so a long render doesn't monopolize it
 * (spec-WI-072 §4). `setImmediate` fires in the check phase after pending I/O
 * callbacks, with no minimum-timer clamp — the standard "let the loop
 * breathe between CPU chunks" primitive. Shared with xlsx.ts (single source
 * of truth) since it already imports export-family helpers from this module.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Pure data-preparation step, deliberately separated from PDF rendering so
 * the row/cell derivation — which must match buildGroupCsv's cells exactly,
 * modulo CSV's RFC 4180 escaping — is directly unit-testable for data parity.
 * Kept as-is per spec-WI-029 §2 (scope boundary): only the rendering below
 * (buildGroupPdf) changes.
 */
export function buildGroupPdfTable(
  members: CsvMember[],
  expenses: CsvExpenseRow[],
  settlements: CsvSettlementRow[],
): { header: string[]; rows: string[][] } {
  const header = [
    'Date',
    'Description',
    'Category',
    'Currency',
    'Amount',
    'Paid by',
    'Split type',
    ...members.map((m) => m.name),
  ];
  const rows: string[][] = [];

  for (const expense of expenses) {
    const paidBy = new Map(expense.payers.map((p) => [p.userId, p.amount]));
    const owedBy = new Map(expense.splits.map((s) => [s.userId, s.amount]));
    rows.push([
      isoDate(expense.date),
      expense.description,
      expense.category,
      expense.currency,
      decimalString(expense.amount, expense.currency),
      expense.payers.map((p) => p.name).join(', '),
      expense.splitType,
      ...members.map((m) =>
        decimalString((paidBy.get(m.id) ?? 0) - (owedBy.get(m.id) ?? 0), expense.currency),
      ),
    ]);
  }

  for (const settlement of settlements) {
    rows.push([
      isoDate(settlement.date),
      `Settlement: ${settlement.fromName} → ${settlement.toName}`,
      '',
      settlement.currency,
      decimalString(settlement.amount, settlement.currency),
      settlement.fromName,
      '',
      ...members.map((m) =>
        decimalString(
          m.id === settlement.fromUserId
            ? settlement.amount
            : m.id === settlement.toUserId
              ? -settlement.amount
              : 0,
          settlement.currency,
        ),
      ),
    ]);
  }

  return { header, rows };
}

// ---------------------------------------------------------------------------
// Balance-summary computation (ADR-021, shared verbatim with WI-030's CSV
// summary). Nets are computed once, over the same already-loaded
// expenses/settlements — never a second computeNets call, never a second
// query. Strictly per-currency; the WI-001 converted display figure is never
// read here (ARCH invariant 5).
// ---------------------------------------------------------------------------

/** Light-mode STYLE.md values, reused verbatim — never invent new colors. */
export const COLOR_POSITIVE = '#006300';
export const COLOR_NEGATIVE = '#d03b3b';
export const COLOR_NEUTRAL = '#000000';

export type BalanceSummaryStatus = 'owed' | 'owes' | 'settled';

export interface BalanceSummaryLine {
  currency: string;
  memberId: string;
  memberName: string;
  /** Signed net in minor units; > 0 = owed to them, < 0 = they owe. */
  net: number;
  status: BalanceSummaryStatus;
}

export interface BalanceSummaryCurrency {
  currency: string;
  lines: BalanceSummaryLine[];
  /** Sum of every positive per-member net in this currency (ADR-021), never a naive signed sum. */
  totalOutstanding: number;
}

function netStatus(net: number): BalanceSummaryStatus {
  if (net > 0) return 'owed';
  if (net < 0) return 'owes';
  return 'settled';
}

/**
 * Per-currency member nets + total-outstanding, computed once via
 * `computeNets` over the same expenses/settlements the table rows already
 * derive from. `members` controls which per-member lines are displayed
 * (active members, display order); `totalOutstanding` is summed over every
 * participant in that currency's net map (including e.g. former members),
 * since the zero-sum equivalence (sum of positives == sum of |negatives|)
 * only holds over the full participant set, per ADR-021.
 */
export function computeBalanceSummary(
  members: CsvMember[],
  expenses: readonly CsvExpenseRow[],
  settlements: readonly CsvSettlementRow[],
): BalanceSummaryCurrency[] {
  const nets = computeNets(expenses, settlements);
  const currencies = [...nets.keys()].sort((a, b) => a.localeCompare(b));

  return currencies.map((currency) => {
    const perUser = nets.get(currency)!;
    const lines: BalanceSummaryLine[] = members.map((m) => {
      const net = perUser.get(m.id) ?? 0;
      return { currency, memberId: m.id, memberName: m.name, net, status: netStatus(net) };
    });
    const totalOutstanding = [...perUser.values()]
      .filter((n) => n > 0)
      .reduce((sum, n) => sum + n, 0);
    return { currency, lines, totalOutstanding };
  });
}

/**
 * Renders one balance-summary line's text + color per STYLE.md's
 * signed-color convention (mirrors `MoneyText` `signed-color` mode): a
 * positive net in green with a leading "+", a negative net in red with its
 * own "-", and an exactly-zero net neutral, labeled "settled up" — never
 * colored green or red, and sign/wording always accompanies color (never a
 * bare color-only signal).
 */
export function formatBalanceLine(line: BalanceSummaryLine): { text: string; color: string } {
  if (line.status === 'settled') {
    return { text: `${line.memberName} — ${line.currency} settled up`, color: COLOR_NEUTRAL };
  }
  const sign = line.status === 'owed' ? '+' : '-';
  const amount = decimalString(Math.abs(line.net), line.currency);
  const color = line.status === 'owed' ? COLOR_POSITIVE : COLOR_NEGATIVE;
  return { text: `${line.memberName} — ${line.currency} ${sign}${amount}`, color };
}

/** "Total outstanding" line text for one currency (ADR-021 §1). */
export function formatTotalOutstandingLine(currency: string, totalOutstanding: number): string {
  return `Total outstanding (${currency}): ${decimalString(totalOutstanding, currency)}`;
}

// ---------------------------------------------------------------------------
// Column layout (pure, testable independent of pdfkit).
// ---------------------------------------------------------------------------

const BASE_COLUMN_WEIGHTS = [1.1, 2.2, 1.3, 0.9, 1.1, 1.4, 1.1]; // Date .. Split type
const MEMBER_COLUMN_WEIGHT = 1.1;

/**
 * Minimum legible width for a member (net) column at 8pt — fits ~5
 * right-aligned characters plus padding (spec-WI-029 §3).
 */
export const MIN_MEMBER_COL_PT = 32;

/** Base (non-member) columns must keep at least this much combined width to stay readable. */
export const BASE_MIN_PT = 320;

/** Reduced member column font once the many-member fallback (§3.4) engages. */
export const MEMBER_FONT_SMALL = 6.5;

/** Base-column proportional split for a given budget (sums to `budget`). */
function splitBaseColumns(budget: number): number[] {
  const totalWeight = BASE_COLUMN_WEIGHTS.reduce((a, b) => a + b, 0);
  return BASE_COLUMN_WEIGHTS.map((w) => (w / totalWeight) * budget);
}

/**
 * Column x-widths for the table: 7 base columns + one per member, summing to
 * `usableWidth`. Small/medium groups keep the original proportional split
 * (spec-WI-029 §3 step 1-2). Once the proportional member-column width would
 * fall below `MIN_MEMBER_COL_PT`, member columns are clamped to the floor and
 * the remaining width is redistributed across the base columns by weight
 * (step 3), as long as the base budget stays >= `BASE_MIN_PT`. Once even that
 * floor can't fit (many-member overflow, step 4), base columns get exactly
 * `BASE_MIN_PT` and the remainder is split equally across members (below the
 * floor — the many-member fallback compensates with a smaller font, see
 * `memberColumnFont`). NB: with the constants above, whenever the
 * proportional split violates the member floor the leftover base budget is
 * already below `BASE_MIN_PT` too, so step 3 falls straight through to step 4
 * in practice; the branch is kept for defensiveness/future constant tuning.
 */
export function computeColumnWidths(memberCount: number, usableWidth: number): number[] {
  const weights = [...BASE_COLUMN_WEIGHTS, ...Array(memberCount).fill(MEMBER_COLUMN_WEIGHT)];
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const proportional = weights.map((w) => (w / totalWeight) * usableWidth);
  if (memberCount === 0) return proportional;

  const memberProportional = proportional.slice(BASE_COLUMN_WEIGHTS.length);
  if (Math.min(...memberProportional) >= MIN_MEMBER_COL_PT) return proportional;

  const baseBudget = usableWidth - MIN_MEMBER_COL_PT * memberCount;
  if (baseBudget >= BASE_MIN_PT) {
    return [...splitBaseColumns(baseBudget), ...Array(memberCount).fill(MIN_MEMBER_COL_PT)];
  }

  // Many-member overflow (step 4): base columns take the floor, the rest is shared equally.
  const memberWidth = (usableWidth - BASE_MIN_PT) / memberCount;
  return [...splitBaseColumns(BASE_MIN_PT), ...Array(memberCount).fill(memberWidth)];
}

/**
 * Whether the many-member fallback (smaller member font + abbreviated
 * headers, spec-WI-029 §3.4) engages for this member count/usable width —
 * exactly when `computeColumnWidths` would fall back to the base-minimum +
 * equal-split overflow path. Exposed as a pure helper so the threshold is
 * unit-testable without instantiating a PDFDocument.
 */
export function memberColumnFont(memberCount: number, usableWidth: number): 8 | 6.5 {
  if (memberCount === 0) return 8;
  const baseBudget = usableWidth - MIN_MEMBER_COL_PT * memberCount;
  return baseBudget < BASE_MIN_PT ? MEMBER_FONT_SMALL : 8;
}

/**
 * Per-column alignment rule (spec-WI-029 §1): Amount (index 4) and every
 * member net column (index >= 7) are numeric and right-aligned; every other
 * column is left-aligned text. Header cells use the same rule as body cells
 * so headers sit over their digits.
 */
export function isNumericColumn(index: number): boolean {
  return index === 4 || index >= 7;
}

function columnAlign(index: number): 'left' | 'right' {
  return isNumericColumn(index) ? 'right' : 'left';
}

/** Abbreviate a member's display name to its first token (spec-WI-029 §3.4). */
function abbreviateMemberName(name: string): string {
  return name.split(' ')[0];
}

// ---------------------------------------------------------------------------
// Rendering (buildGroupPdf) — a real gridded table, branded header repeated
// on every page, and the balance-summary section. `compress: false` so the
// output is easier to introspect structurally in tests without ever adding a
// decode step to the production pipeline itself.
// ---------------------------------------------------------------------------

const ROW_HEIGHT = 16;
const HEADER_ROW_HEIGHT = 18;
const SUMMARY_LINE_HEIGHT = 14;
const CELL_PADDING = 2;

/** Rows per event-loop yield in the main render loop (spec-WI-072 §4). Small/
 *  typical groups (<=50 rows) never hit this and see zero behavior change. */
const CHUNK_ROWS = 50;

/** Neutral light surface tint for zebra row striping (STYLE.md subtle surface, not a signed color). */
export const ROW_STRIPE = '#f4f3f1';
/** Fill behind the column-header row — a second hierarchy cue alongside the bold header text. */
export const HEADER_FILL = '#e7e5e1';

/**
 * Build the PDF body for one group. Mirrors buildGroupCsv's data exactly
 * (via buildGroupPdfTable) but renders it as a real gridded table with a
 * branded header (repeated on every page) plus a per-member colored
 * balance-summary section, instead of a plain `'  |  '`-joined text dump.
 * Empty group -> a valid PDF with the branded header, a graceful empty-table
 * notice, and a "settled up" balance summary — never an error.
 */
export async function buildGroupPdf(
  group: CsvGroup,
  members: CsvMember[],
  expenses: CsvExpenseRow[],
  settlements: CsvSettlementRow[],
): Promise<Buffer> {
  const { header, rows } = buildGroupPdfTable(members, expenses, settlements);
  const summary = computeBalanceSummary(members, expenses, settlements);

  const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape', compress: false });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidths = computeColumnWidths(members.length, usableWidth);
  const memberFont = memberColumnFont(members.length, usableWidth);
  const bottomOf = () => doc.page.height - doc.page.margins.bottom;

  function drawCell(
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    align: 'left' | 'right' = 'left',
  ): void {
    doc.rect(x, y, width, height).stroke();
    doc.text(text, x + CELL_PADDING, y + (height - 9) / 2, {
      width: width - CELL_PADDING * 2,
      height: height - CELL_PADDING,
      ellipsis: true,
      lineBreak: false,
      align,
    });
  }

  /** Font size for column `i`: reduced only for member columns past the many-member threshold. */
  function fontSizeForColumn(i: number): number {
    return i >= 7 ? memberFont : 8;
  }

  /** Group emoji + name heading, visually distinct from the table header row. */
  function drawBranding(): number {
    const title = group.name ? [group.emoji, group.name].filter(Boolean).join(' ') : 'Group export';
    doc.fontSize(18).fillColor(COLOR_NEUTRAL).font('Helvetica-Bold');
    doc.text(title, left, doc.page.margins.top, { lineBreak: false });
    doc.font('Helvetica');
    return doc.page.margins.top + 26;
  }

  function drawColumnHeaderRow(y: number): number {
    doc.fillColor(HEADER_FILL).rect(left, y, usableWidth, HEADER_ROW_HEIGHT).fill();
    doc.fillColor(COLOR_NEUTRAL).font('Helvetica-Bold');
    let x = left;
    for (let i = 0; i < header.length; i++) {
      const isMemberCol = i >= 7;
      const text = isMemberCol && memberFont === MEMBER_FONT_SMALL ? abbreviateMemberName(header[i]) : header[i];
      doc.fontSize(fontSizeForColumn(i));
      drawCell(text, x, y, colWidths[i], HEADER_ROW_HEIGHT, columnAlign(i));
      x += colWidths[i];
    }
    doc.font('Helvetica');
    return y + HEADER_ROW_HEIGHT;
  }

  /** Page break: start a new page and re-draw the branding + column-header row (AC §3.1). */
  function newPage(): number {
    doc.addPage();
    return drawColumnHeaderRow(drawBranding());
  }

  function ensureSpace(y: number, neededHeight: number): number {
    return y + neededHeight > bottomOf() ? newPage() : y;
  }

  let y = drawColumnHeaderRow(drawBranding());

  if (rows.length === 0) {
    doc.fontSize(9).fillColor(COLOR_NEUTRAL);
    doc.text('No expenses or settlements recorded yet.', left, y + 4);
    y += 20;
  } else {
    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      y = ensureSpace(y, ROW_HEIGHT);
      if (idx % 2 === 1) {
        doc.fillColor(ROW_STRIPE).rect(left, y, usableWidth, ROW_HEIGHT).fill();
      }
      doc.fillColor(COLOR_NEUTRAL);
      let x = left;
      for (let i = 0; i < row.length; i++) {
        doc.fontSize(fontSizeForColumn(i));
        drawCell(row[i], x, y, colWidths[i], ROW_HEIGHT, columnAlign(i));
        x += colWidths[i];
      }
      y += ROW_HEIGHT;
      if (idx % CHUNK_ROWS === CHUNK_ROWS - 1) await yieldToEventLoop();
    }
  }

  // -- Balance summary (additive, WI-029 §3.3 / ADR-021) ----------------------
  y = ensureSpace(y, SUMMARY_LINE_HEIGHT * 2 + 10) + 10;
  doc.fontSize(11).fillColor(COLOR_NEUTRAL).font('Helvetica-Bold');
  doc.text('Balance summary', left, y, { lineBreak: false });
  doc.font('Helvetica').fontSize(9);
  y += 18;

  if (summary.length === 0) {
    doc.fillColor(COLOR_NEUTRAL).text('All members are settled up.', left, y, { lineBreak: false });
    y += SUMMARY_LINE_HEIGHT;
  } else {
    for (const currencySummary of summary) {
      for (const line of currencySummary.lines) {
        y = ensureSpace(y, SUMMARY_LINE_HEIGHT);
        const { text, color } = formatBalanceLine(line);
        doc.fillColor(color).text(text, left, y, { lineBreak: false });
        y += SUMMARY_LINE_HEIGHT;
      }
      y = ensureSpace(y, SUMMARY_LINE_HEIGHT);
      doc.font('Helvetica-Bold').fillColor(COLOR_NEUTRAL);
      doc.text(
        formatTotalOutstandingLine(currencySummary.currency, currencySummary.totalOutstanding),
        left,
        y,
        { lineBreak: false },
      );
      doc.font('Helvetica');
      y += SUMMARY_LINE_HEIGHT + 6;
    }
  }

  doc.end();
  return done;
}
