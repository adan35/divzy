import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyPluginAsync } from 'fastify';
import { env } from '../config/env';
import { AppError } from '../lib/errors';

// Receipt uploads (docs/CONTRACTS.md §Uploads). Size limit is enforced by the
// global @fastify/multipart registration (MAX_UPLOAD_MB) — exceeding it makes
// the stream throw a 413 that the global error handler passes through.

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
};

const routes: FastifyPluginAsync = async (app) => {
  // -- POST /uploads/receipts — multipart field `file` -----------------------
  app.post('/uploads/receipts', { preHandler: [app.authenticate] }, async (request, reply) => {
    const file = await request.file();
    if (!file) {
      throw new AppError(400, 'FILE_REQUIRED', 'Attach a file in the multipart "file" field');
    }

    const extension = EXTENSION_BY_MIME[file.mimetype.toLowerCase()];
    if (!extension) {
      // Drain the stream so the request body is fully consumed before erroring.
      file.file.resume();
      throw new AppError(
        400,
        'UNSUPPORTED_FILE_TYPE',
        'Receipts must be a JPEG, PNG, WebP, HEIC image or a PDF',
      );
    }

    const receiptsDir = path.join(path.resolve(env.UPLOAD_DIR), 'receipts');
    await mkdir(receiptsDir, { recursive: true });

    const filename = `${randomBytes(16).toString('hex')}.${extension}`;
    const destination = path.join(receiptsDir, filename);
    try {
      await pipeline(file.file, createWriteStream(destination));
    } catch (err) {
      // Never leave partial files behind (e.g. size-limit abort mid-stream).
      await unlink(destination).catch(() => undefined);
      throw err;
    }

    return reply.status(201).send({ url: `/uploads/receipts/${filename}` });
  });
};

export default routes;
