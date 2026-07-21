import { describe, expect, it } from 'vitest';
import { buildGroupCsv, type CsvExpenseRow, type CsvMember, type CsvSettlementRow } from '../src/lib/csv';

// Regression coverage for the WI-018 refactor that extracted `decimalString`
// out of csv.ts into lib/money-format.ts (ADR-014 binding condition #1).
// This fixture's exact byte output was captured before AND after the
// extraction and diffed identically (see build-WI-018.md) — this test locks
// that output in going forward so the CSV export never silently regresses.
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

describe('buildGroupCsv (regression — byte-for-byte unchanged by the WI-018 decimalString extraction)', () => {
  it('produces the exact expected CSV for the fixture group, including the WI-030 balance summary', () => {
    // Net per member per currency (computeNets over the fixture):
    //   JPY: Ana -750 (they owe), Sam +750 (owed to them) -> total outstanding 750
    //   KWD: Ana +12340/12.340 (owed to them), Sam -12340/-12.340 (they owe) -> total outstanding 12.340
    const csv = buildGroupCsv(group, members, expenses, settlements);
    expect(csv).toBe(
      'Date,Description,Category,Currency,Amount,Paid by,Split type,Ana,Sam\r\n' +
        '2026-01-05,Dinner,FOOD_DRINK,KWD,12.340,Ana,EQUAL,6.170,-6.170\r\n' +
        '2026-01-06,"Taxi, ""airport""",TRANSPORT,JPY,1500,Sam,EQUAL,-750,750\r\n' +
        '2026-01-07,Settlement: Ana → Sam,,KWD,6.170,Ana,,6.170,-6.170\r\n' +
        '\r\n' +
        'Balance summary\r\n' +
        'Member,Currency,Net,Direction\r\n' +
        'Ana,JPY,-750,they owe\r\n' +
        'Sam,JPY,+750,owed to them\r\n' +
        'Ana,KWD,+12.340,owed to them\r\n' +
        'Sam,KWD,-12.340,they owe\r\n' +
        'Total outstanding,JPY,750\r\n' +
        'Total outstanding,KWD,12.340\r\n',
    );
  });

  it('produces a header-only CSV plus an empty balance-summary header for an empty group', () => {
    const csv = buildGroupCsv(group, members, [], []);
    expect(csv).toBe(
      'Date,Description,Category,Currency,Amount,Paid by,Split type,Ana,Sam\r\n' +
        '\r\n' +
        'Balance summary\r\n' +
        'Member,Currency,Net,Direction\r\n',
    );
  });
});

describe('buildGroupCsv balance summary (WI-030 / ADR-021)', () => {
  it('labels a member with an exact zero net as "settled up", never blank', () => {
    const zeroMembers: CsvMember[] = [
      { id: 'u1', name: 'Ana' },
      { id: 'u2', name: 'Sam' },
    ];
    const zeroExpenses: CsvExpenseRow[] = [
      {
        date: new Date('2026-02-01T00:00:00Z'),
        description: 'Even split',
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
    const csv = buildGroupCsv(group, zeroMembers, zeroExpenses, []);
    expect(csv).toContain('Ana,USD,0.00,settled up');
    expect(csv).toContain('Sam,USD,0.00,settled up');
    expect(csv).toContain('Total outstanding,USD,0.00');
  });

  it('keeps currencies separate in the summary (no cross-currency mixing)', () => {
    const csv = buildGroupCsv(group, members, expenses, settlements);
    const summaryStart = csv.indexOf('Balance summary');
    const summary = csv.slice(summaryStart);
    expect(summary).toContain('JPY');
    expect(summary).toContain('KWD');
    // Every summary row only ever carries a single currency value.
    const rows = summary.trim().split('\r\n').slice(2); // skip section header + column header
    for (const row of rows) {
      const hasJpy = row.includes('JPY');
      const hasKwd = row.includes('KWD');
      expect(hasJpy && hasKwd).toBe(false);
    }
  });

  it('escapes a member name containing a comma/quote inside the summary Member column', () => {
    const specialMembers: CsvMember[] = [{ id: 'u1', name: 'Doe, "Jr."' }];
    const specialExpenses: CsvExpenseRow[] = [
      {
        date: new Date('2026-02-01T00:00:00Z'),
        description: 'Solo item',
        category: 'FOOD_DRINK',
        currency: 'USD',
        amount: 1000,
        splitType: 'EQUAL',
        payers: [{ userId: 'u1', name: 'Doe, "Jr."', amount: 1000 }],
        splits: [{ userId: 'u1', amount: 0 }],
      },
    ];
    const csv = buildGroupCsv(group, specialMembers, specialExpenses, []);
    expect(csv).toContain('"Doe, ""Jr.""",USD,+10.00,owed to them');
  });
});
