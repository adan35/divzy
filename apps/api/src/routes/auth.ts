import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { Prisma, type User } from '@prisma/client';
import {
  AVATAR_COLORS,
  isSupportedCurrency,
  zLoginInput,
  zRefreshInput,
  zRegisterInput,
  type AuthResponseDto,
} from '@divzy/shared';
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  hashPassword,
  issueAuthTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  setRefreshCookie,
  verifyPassword,
  type AuthTokens,
  type TokenMeta,
} from '../lib/auth';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { toUserDto } from '../lib/serializers';

/** Per CONTRACTS: login/register are limited to 10 requests/min/IP. */
const authRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

function requestMeta(request: FastifyRequest): TokenMeta {
  const meta: TokenMeta = {};
  const userAgent = request.headers['user-agent'];
  if (userAgent) meta.userAgent = userAgent;
  if (request.ip) meta.ip = request.ip;
  return meta;
}

function authResponse(user: User, tokens: AuthTokens): AuthResponseDto {
  return {
    user: toUserDto(user),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessTokenExpiresIn: tokens.accessTokenExpiresIn,
  };
}

/** Identical message whether the email exists or not — never leak account presence. */
function invalidCredentials(): AppError {
  return new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
}

const routes: FastifyPluginAsync = async (app) => {
  // -- POST /auth/register ----------------------------------------------------
  app.post('/auth/register', { config: authRateLimit }, async (request, reply) => {
    const input = zRegisterInput.parse(request.body);
    if (input.defaultCurrency && !isSupportedCurrency(input.defaultCurrency)) {
      throw new AppError(
        400,
        'UNSUPPORTED_CURRENCY',
        `Currency ${input.defaultCurrency} is not supported`,
      );
    }

    const existing = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
    }

    const [passwordHash, userCount] = await Promise.all([
      hashPassword(input.password),
      prisma.user.count(),
    ]);

    let user: User;
    try {
      user = await prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          name: input.name,
          avatarColor: AVATAR_COLORS[userCount % AVATAR_COLORS.length],
          defaultCurrency: input.defaultCurrency ?? 'USD',
        },
      });
    } catch (err) {
      // Concurrent register with the same email → surface the domain code.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
      }
      throw err;
    }

    const tokens = await issueAuthTokens(app, user, requestMeta(request));
    setRefreshCookie(reply, tokens.refreshToken);
    return reply.code(201).send(authResponse(user, tokens));
  });

  // -- POST /auth/login ---------------------------------------------------------
  app.post('/auth/login', { config: authRateLimit }, async (request, reply) => {
    const input = zLoginInput.parse(request.body);
    // Exactly one targeted lookup per kind (never both) — WI-045/ADR-024.
    const user = await prisma.user.findUnique({
      where: input.kind === 'email' ? { email: input.identifier } : { phone: input.identifier },
    });
    const passwordOk = user ? await verifyPassword(user.passwordHash, input.password) : false;
    if (!user || !passwordOk) throw invalidCredentials();

    const tokens = await issueAuthTokens(app, user, requestMeta(request));
    setRefreshCookie(reply, tokens.refreshToken);
    return authResponse(user, tokens);
  });

  // -- POST /auth/refresh --------------------------------------------------------
  app.post('/auth/refresh', async (request, reply) => {
    const input = zRefreshInput.parse(request.body ?? {});
    // Body token (mobile) takes precedence over the httpOnly cookie (web).
    const rawToken = input.refreshToken ?? request.cookies[REFRESH_COOKIE];
    if (!rawToken) {
      throw new AppError(401, 'MISSING_REFRESH_TOKEN', 'No refresh token provided');
    }

    try {
      const { user, tokens } = await rotateRefreshToken(app, rawToken, requestMeta(request));
      setRefreshCookie(reply, tokens.refreshToken);
      return authResponse(user, tokens);
    } catch (err) {
      // A dead token is useless — drop the cookie so web clients stop retrying it.
      if (err instanceof AppError && err.statusCode === 401) clearRefreshCookie(reply);
      throw err;
    }
  });

  // -- POST /auth/logout ------------------------------------------------------------
  app.post('/auth/logout', async (request, reply) => {
    const input = zRefreshInput.parse(request.body ?? {});
    const rawToken = input.refreshToken ?? request.cookies[REFRESH_COOKIE];
    // 204 even for unknown/absent tokens — logout is idempotent.
    if (rawToken) await revokeRefreshToken(rawToken);
    clearRefreshCookie(reply);
    return reply.code(204).send();
  });

  // -- GET /auth/me --------------------------------------------------------------------
  app.get('/auth/me', { preHandler: [app.authenticate] }, async (request) => {
    const user = await prisma.user.findUnique({ where: { id: request.userId } });
    if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
    return toUserDto(user);
  });
};

export default routes;
