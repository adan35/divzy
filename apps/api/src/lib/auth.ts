import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { User } from '@prisma/client';
import { env } from '../config/env';
import { AppError } from './errors';
import { prisma } from './prisma';

export const REFRESH_COOKIE = 'divzy_rt';

/** Cookie is scoped to the auth routes only — it never rides other requests. */
const REFRESH_COOKIE_PATH = '/api/v1/auth';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  accessTokenExpiresIn: number;
}

export interface TokenMeta {
  userAgent?: string;
  ip?: string;
}

export async function hashPassword(pw: string): Promise<string> {
  return argon2.hash(pw, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, pw: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, pw);
  } catch {
    return false;
  }
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** 48 random bytes, hex-encoded. Stored server-side only as a sha256 hash. */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('hex');
}

/**
 * Sign a short-lived access JWT ({ sub: user.id }) and mint a refresh token
 * persisted (hashed) in the RefreshToken table.
 */
export async function issueAuthTokens(
  app: FastifyInstance,
  user: User,
  meta?: TokenMeta,
): Promise<AuthTokens> {
  const accessToken = app.jwt.sign({ sub: user.id }, { expiresIn: `${env.ACCESS_TOKEN_TTL_MIN}m` });
  const refreshToken = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      userAgent: meta?.userAgent ?? null,
      ip: meta?.ip ?? null,
    },
  });
  return { accessToken, refreshToken, accessTokenExpiresIn: env.ACCESS_TOKEN_TTL_MIN * 60 };
}

/**
 * Rotate a refresh token: revoke the presented one and issue a fresh pair.
 * Reuse of an already-revoked token is treated as theft — ALL of the user's
 * refresh tokens are revoked and the request fails with 401 TOKEN_REUSED.
 */
export async function rotateRefreshToken(
  app: FastifyInstance,
  rawToken: string,
  meta?: TokenMeta,
): Promise<{ user: User; tokens: AuthTokens }> {
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(rawToken) },
    include: { user: true },
  });
  if (!row) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid');
  }
  if (row.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: row.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new AppError(401, 'TOKEN_REUSED', 'Refresh token reuse detected; all sessions revoked');
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new AppError(401, 'REFRESH_TOKEN_EXPIRED', 'Refresh token has expired');
  }

  await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  const tokens = await issueAuthTokens(app, row.user, meta);
  return { user: row.user, tokens };
}

/** Revoke a single refresh token. Silently succeeds for unknown tokens. */
export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE, token, {
    path: REFRESH_COOKIE_PATH,
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400,
  });
}

export function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
}
