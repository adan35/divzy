import fs from 'node:fs';
import path from 'node:path';
import fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { env } from './config/env';
import { registerErrorHandler } from './lib/errors';
import authGuard from './plugins/auth-guard';
import healthRoutes from './routes/health';
import activityRoutes from './routes/activity';
import analyticsRoutes from './routes/analytics';
import authRoutes from './routes/auth';
import balancesRoutes from './routes/balances';
import expensesRoutes from './routes/expenses';
import friendsRoutes from './routes/friends';
import groupsRoutes from './routes/groups';
import notificationsRoutes from './routes/notifications';
import recurringRoutes from './routes/recurring';
import settlementsRoutes from './routes/settlements';
import uploadsRoutes from './routes/uploads';
import usersRoutes from './routes/users';

const API_PREFIX = '/api/v1';

/**
 * WI-077 — gated on the explicit LOG_PRETTY opt-in flag, not NODE_ENV: a
 * missing/misconfigured NODE_ENV must fail safe to lean JSON logging, never
 * silently fall back to the synchronous, verbose pino-pretty debug
 * transport. Pulled out as a pure function so the decision table is
 * unit-testable without booting Fastify.
 */
export function resolveLoggerOptions(
  config: Pick<typeof env, 'LOG_PRETTY' | 'NODE_ENV'>,
): FastifyServerOptions['logger'] {
  if (config.LOG_PRETTY) {
    return {
      level: 'debug',
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    };
  }
  return { level: config.NODE_ENV === 'test' ? 'silent' : 'info' };
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = fastify({
    logger: resolveLoggerOptions(env),
    trustProxy: true,
  });

  // Security & platform plugins -------------------------------------------
  await app.register(helmet, {
    // Receipts are embedded cross-origin by the web/mobile apps.
    crossOriginResourcePolicy: false,
  });
  await app.register(cors, { origin: env.CORS_ORIGINS, credentials: true });
  await app.register(cookie, { secret: env.COOKIE_SECRET });
  await app.register(jwt, { secret: env.JWT_ACCESS_SECRET });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
  await app.register(multipart, {
    limits: { fileSize: Math.floor(env.MAX_UPLOAD_MB * 1024 * 1024) },
  });

  // Receipt uploads served from local disk ---------------------------------
  const uploadRoot = path.resolve(env.UPLOAD_DIR);
  fs.mkdirSync(uploadRoot, { recursive: true });
  await app.register(fastifyStatic, { root: uploadRoot, prefix: '/uploads/' });

  // OpenAPI docs ------------------------------------------------------------
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Divzy API',
        description: 'Expense splitting: groups, friends, multi-payer expenses, settlements.',
        version: '1.0.0',
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  registerErrorHandler(app);
  await app.register(authGuard);

  // Routes -------------------------------------------------------------------
  await app.register(healthRoutes);
  const apiModules = [
    authRoutes,
    usersRoutes,
    groupsRoutes,
    expensesRoutes,
    uploadsRoutes,
    settlementsRoutes,
    balancesRoutes,
    friendsRoutes,
    activityRoutes,
    notificationsRoutes,
    recurringRoutes,
    analyticsRoutes,
  ];
  for (const routeModule of apiModules) {
    await app.register(routeModule, { prefix: API_PREFIX });
  }

  return app;
}
