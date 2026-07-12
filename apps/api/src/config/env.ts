import 'dotenv/config';
import { z } from 'zod';

/** Treat empty-string env vars (e.g. `SMTP_HOST=`) as unset. */
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const zOptionalString = z.preprocess(emptyToUndefined, z.string().optional());
const zPort = z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535));

const zBooleanFlag = (defaultValue: boolean) =>
  z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .transform((v) =>
        v === undefined ? defaultValue : ['true', '1', 'yes', 'on'].includes(v.toLowerCase()),
      ),
  );

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (postgres connection string)'),

  PORT: zPort.default(4000),
  HOST: z.preprocess(emptyToUndefined, z.string().default('0.0.0.0')),
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(['development', 'test', 'production']).default('development'),
  ),

  CORS_ORIGINS: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .default('http://localhost:3000,http://localhost:8081')
      .transform((s) =>
        s
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      ),
  ),

  WEB_URL: z.preprocess(emptyToUndefined, z.string().url().default('http://localhost:3000')),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  COOKIE_SECRET: z.string().min(16, 'COOKIE_SECRET must be at least 16 characters'),

  ACCESS_TOKEN_TTL_MIN: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(15)),
  REFRESH_TOKEN_TTL_DAYS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().default(30),
  ),

  UPLOAD_DIR: z.preprocess(emptyToUndefined, z.string().default('./uploads')),
  MAX_UPLOAD_MB: z.preprocess(emptyToUndefined, z.coerce.number().positive().default(10)),

  SMTP_HOST: zOptionalString,
  SMTP_PORT: zPort.default(1026),
  SMTP_USER: zOptionalString,
  SMTP_PASS: zOptionalString,
  SMTP_FROM: z.preprocess(emptyToUndefined, z.string().default('Divzy <no-reply@divzy.app>')),

  EXCHANGE_RATE_API_URL: z.preprocess(
    emptyToUndefined,
    z.string().url().default('https://open.er-api.com/v6/latest'),
  ),

  EXPO_PUSH_ENABLED: zBooleanFlag(true),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    // Bootstrapping failure: the logger does not exist yet, so write to stderr.
    console.error(
      [
        'Invalid environment configuration. Fix apps/api/.env (see apps/api/.env.example):',
        ...lines,
      ].join('\n'),
    );
    process.exit(1);
  }
  return parsed.data;
}

export const env: Env = loadEnv();
