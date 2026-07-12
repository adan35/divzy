/**
 * Cursor pagination helper. Callers fetch `limit + 1` rows (ordered
 * `[sortField desc, id desc]`); if the extra row exists there is a next page
 * and `nextCursor` is the id of the LAST RETURNED item (Prisma `cursor` +
 * `skip: 1` on the follow-up query).
 */
export function paginate<T extends { id: string }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  if (rows.length > limit) {
    const items = rows.slice(0, limit);
    return { items, nextCursor: items.length > 0 ? items[items.length - 1]!.id : null };
  }
  return { items: rows, nextCursor: null };
}
