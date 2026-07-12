import { prisma } from './prisma';

/**
 * Ensure a Friendship row exists for every pair among `userIds`.
 * Invariant: userAId < userBId (lexicographic) — one row per pair.
 * Idempotent via skipDuplicates.
 */
export async function ensureFriendshipsAmong(userIds: string[]): Promise<void> {
  const unique = [...new Set(userIds)].sort();
  if (unique.length < 2) return;

  const pairs: Array<{ userAId: string; userBId: string }> = [];
  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      pairs.push({ userAId: unique[i]!, userBId: unique[j]! });
    }
  }

  await prisma.friendship.createMany({ data: pairs, skipDuplicates: true });
}
