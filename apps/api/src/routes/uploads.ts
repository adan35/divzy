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

// WI-035 (auth's slice): avatars get their OWN image-only allow-list — never
// reuse EXTENSION_BY_MIME verbatim (it includes application/pdf) per DRB
// architecture condition C2. SVG is deliberately excluded (anti-stored-XSS,
// DRB security Item 1) — these files are served same-origin by @fastify/static.
const AVATAR_EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

// DRB security condition #4: a dedicated, tighter rate limit than the global
// 300/min on top of the 10 MB per-file cap and the (deferred, disk-fill-risk)
// lack of orphan cleanup / per-user storage quota. Applied to both sibling
// upload routes since both share the exposure.
const uploadRateLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

const routes: FastifyPluginAsync = async (app) => {
  // -- POST /uploads/receipts — multipart field `file` -----------------------
  app.post(
    '/uploads/receipts',
    { preHandler: [app.authenticate], config: uploadRateLimit },
    async (request, reply) => {
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
    },
  );

  // -- POST /uploads/avatars — multipart field `file` (WI-035) ---------------
  // Image-only sibling of /uploads/receipts: own MIME allow-list, own
  // directory, same random-filename / drain-on-reject / no-partial-file
  // conventions. NOTE (WI-035 DRB security condition, conscious v1 deferral):
  // uploaded bytes are stored as-is — EXIF/GPS metadata is NOT stripped.
  // Adding image processing (e.g. sharp) to strip it is out of scope for this
  // WI (no such dependency exists in package.json); tracked as a documented
  // known gap for release notes, not a silent omission.
  app.post(
    '/uploads/avatars',
    { preHandler: [app.authenticate], config: uploadRateLimit },
    async (request, reply) => {
      const file = await request.file();
      if (!file) {
        throw new AppError(400, 'FILE_REQUIRED', 'Attach a file in the multipart "file" field');
      }

      const extension = AVATAR_EXTENSION_BY_MIME[file.mimetype.toLowerCase()];
      if (!extension) {
        // Drain the stream so the request body is fully consumed before erroring.
        file.file.resume();
        throw new AppError(
          400,
          'UNSUPPORTED_FILE_TYPE',
          'Avatars must be a JPEG, PNG, WebP, HEIC or HEIF image',
        );
      }

      const avatarsDir = path.join(path.resolve(env.UPLOAD_DIR), 'avatars');
      await mkdir(avatarsDir, { recursive: true });

      const filename = `${randomBytes(16).toString('hex')}.${extension}`;
      const destination = path.join(avatarsDir, filename);
      try {
        await pipeline(file.file, createWriteStream(destination));
      } catch (err) {
        // Never leave partial files behind (e.g. size-limit abort mid-stream).
        await unlink(destination).catch(() => undefined);
        throw err;
      }

      return reply.status(201).send({ url: `/uploads/avatars/${filename}` });
    },
  );
};

export default routes;
