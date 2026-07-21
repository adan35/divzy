import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Shared 10-char base32 (A-Z2-7) crypto-random code generator, used by group
// invite codes (groups.ts) and the WI-040 FriendCode. 256 % 32 === 0, so
// byte % 32 is uniform.
// ---------------------------------------------------------------------------

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const RANDOM_CODE_LENGTH = 10;
export const RANDOM_CODE_ATTEMPTS = 5;

export function generateRandomCode(): string {
  const bytes = randomBytes(RANDOM_CODE_LENGTH);
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
