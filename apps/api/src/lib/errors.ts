import { STATUS_CODES } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { MoneyError, SplitError, type ApiErrorBody } from '@divzy/shared';
import { Prisma } from '@prisma/client';
import { env } from '../config/env';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function body(statusCode: number, code: string, message: string): ApiErrorBody {
  return {
    statusCode,
    error: STATUS_CODES[statusCode] ?? 'Error',
    message,
    code,
  };
}

/**
 * Global error mapping (see docs/ARCHITECTURE.md §Error handling):
 * AppError → as-is; ZodError → 400 VALIDATION_ERROR; SplitError/MoneyError →
 * 400 with their code; Prisma P2002 → 409 CONFLICT; P2025 → 404 NOT_FOUND;
 * framework 4xx (rate limit, body parsing, payload too large) pass through;
 * anything else → 500 INTERNAL (logged; message hidden in production).
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    void reply
      .status(404)
      .send(body(404, 'NOT_FOUND', `Route ${request.method} ${request.url} not found`));
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(body(error.statusCode, error.code, error.message));
    }

    if (error instanceof ZodError) {
      const first = error.issues[0];
      const message = first
        ? `${first.path.length > 0 ? `${first.path.join('.')}: ` : ''}${first.message}`
        : 'Invalid request';
      return reply.status(400).send(body(400, 'VALIDATION_ERROR', message));
    }

    if (error instanceof SplitError || error instanceof MoneyError) {
      return reply.status(400).send(body(400, error.code, error.message));
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return reply.status(409).send(body(409, 'CONFLICT', 'A conflicting record already exists'));
      }
      if (error.code === 'P2025') {
        return reply.status(404).send(body(404, 'NOT_FOUND', 'Record not found'));
      }
    }

    const maybeFastify = error as { statusCode?: number; code?: string; message?: string };
    if (
      typeof maybeFastify.statusCode === 'number' &&
      maybeFastify.statusCode >= 400 &&
      maybeFastify.statusCode < 500
    ) {
      return reply
        .status(maybeFastify.statusCode)
        .send(
          body(
            maybeFastify.statusCode,
            typeof maybeFastify.code === 'string' && maybeFastify.code.length > 0
              ? maybeFastify.code
              : 'BAD_REQUEST',
            maybeFastify.message ?? 'Bad request',
          ),
        );
    }

    request.log.error({ err: error }, 'Unhandled error');
    const message =
      env.NODE_ENV === 'production'
        ? 'Internal server error'
        : error instanceof Error
          ? error.message
          : 'Internal server error';
    return reply.status(500).send(body(500, 'INTERNAL', message));
  });
}
