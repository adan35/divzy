import type { ExpenseDto } from '@divzy/shared';
import { AppError } from './errors';
import { prisma } from './prisma';
import { convertAmountsAsOf } from './rates';

/**
 * Current user's `defaultCurrency`, read fresh on every request (never
 * cached) — mirrors `loadDefaultCurrency` in `routes/balances.ts`. Used as
 * the conversion target for every `groupId == null` (direct) expense row.
 */
async function loadViewerDefaultCurrency(viewerId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: viewerId },
    select: { defaultCurrency: true },
  });
  if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Account no longer exists');
  return user.defaultCurrency;
}

/**
 * Enrich already-serialized `ExpenseDto` rows with a display-only converted
 * equivalent of each expense's own total `amount` (WI-014, spec §4). Never
 * touches split/payer/item amounts (D5) — only `toExpenseDto`'s pure output
 * is read/mutated in place and the same array is returned.
 *
 * Target currency per row: the group's home currency for group expenses, the
 * viewer's own `defaultCurrency` for direct expenses (`groupId == null`).
 * Same-currency rows are skipped entirely (D6) — not forwarded to analytics.
 *
 * Remaining rows are bucketed by their own `targetCurrency` and converted
 * with exactly one `convertAmountsAsOf` call per distinct target (§4 step
 * 4) — never one call per row, never one call for the whole page.
 *
 * `convertAmountsAsOf` degrades PER ITEM (DRB R1): each row in a bucket gets
 * its own `'ok'`/`'unresolved'` result, so one row with a bad/future
 * `asOfDate` never strips the converted block from its siblings in the same
 * bucket. The outer try/catch only guards the shared `to` itself being
 * unsupported (400 `UNSUPPORTED_CURRENCY`) — the one failure mode that is
 * still genuinely per-bucket, since `to` is shared across every row in the
 * bucket. On that catch, every row in the bucket is left without a converted
 * block; it never fails the request and never affects any other bucket (D7).
 */
export async function enrichExpensesWithConverted(
  dtos: ExpenseDto[],
  viewerId: string,
): Promise<ExpenseDto[]> {
  if (dtos.length === 0) return dtos;

  const viewerDefault = await loadViewerDefaultCurrency(viewerId);

  const buckets = new Map<string, ExpenseDto[]>();
  for (const dto of dtos) {
    const targetCurrency = dto.group ? dto.group.currency : viewerDefault;
    if (dto.currency === targetCurrency) continue; // D6 — redundant; never forwarded.

    const bucket = buckets.get(targetCurrency);
    if (bucket) {
      bucket.push(dto);
    } else {
      buckets.set(targetCurrency, [dto]);
    }
  }

  for (const [targetCurrency, rows] of buckets) {
    try {
      const results = await convertAmountsAsOf(
        targetCurrency,
        rows.map((row) => ({ amount: row.amount, from: row.currency, asOfDate: row.date })),
      );
      results.forEach((result, index) => {
        if (result.status !== 'ok') return; // per-item unresolved — leave this row's converted block absent.
        const row = rows[index];
        row.convertedAmount = result.amount;
        row.convertedCurrency = targetCurrency;
        row.rateBasis = result.rateBasis;
        row.isApproximateRate = result.rateBasis === 'approximated' || result.rateBasis === 'fallback';
      });
    } catch {
      // D7 — the shared `to` for this bucket was unsupported; leave every
      // row in this bucket without a converted block. Other buckets and the
      // overall request are unaffected.
    }
  }

  return dtos;
}
