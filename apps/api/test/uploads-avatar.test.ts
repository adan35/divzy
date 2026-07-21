// WI-035 (auth's slice, DRB-approved with conditions) — POST /uploads/avatars.
// Sibling to POST /uploads/receipts but image-only, own MIME allow-list, own
// directory, own dedicated rate limit (DRB security condition #4).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { env } from '../src/config/env';

let app: FastifyInstance;
let token: string;

const AVATARS_DIR = path.join(path.resolve(env.UPLOAD_DIR), 'avatars');

function multipartBody(boundary: string, filename: string, contentType: string, content: Buffer) {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([head, content, tail]);
}

beforeEach(async () => {
  app = await buildApp();
  await app.ready();
  token = app.jwt.sign({ sub: 'user_1' });
});

afterEach(async () => {
  await app.close();
  if (existsSync(AVATARS_DIR)) rmSync(AVATARS_DIR, { recursive: true, force: true });
});

describe('POST /api/v1/uploads/avatars', () => {
  it('requires authentication', async () => {
    const boundary = 'boundary1';
    const body = multipartBody(boundary, 'a.jpg', 'image/jpeg', Buffer.from('fake-image-bytes'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/avatars',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a jpeg image and writes it to the avatars directory under a random hex filename', async () => {
    const boundary = 'boundary2';
    const body = multipartBody(boundary, 'a.jpg', 'image/jpeg', Buffer.from('fake-image-bytes'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/avatars',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    const json = res.json<{ url: string }>();
    expect(json.url).toMatch(/^\/uploads\/avatars\/[a-f0-9]{32}\.jpg$/);

    const filename = json.url.split('/').pop()!;
    const filePath = path.join(AVATARS_DIR, filename);
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath).toString()).toBe('fake-image-bytes');
  });

  it('rejects a PDF (image-only allow-list, unlike receipts)', async () => {
    const boundary = 'boundary3';
    const body = multipartBody(boundary, 'a.pdf', 'application/pdf', Buffer.from('%PDF-1.4'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/avatars',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ code: string }>().code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('rejects an SVG (anti-stored-XSS control per DRB security review)', async () => {
    const boundary = 'boundary4';
    const body = multipartBody(boundary, 'a.svg', 'image/svg+xml', Buffer.from('<svg></svg>'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/avatars',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires a file to be attached', async () => {
    const boundary = 'boundary5';
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/avatars',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.from(`--${boundary}--\r\n`),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ code: string }>().code).toBe('FILE_REQUIRED');
  });

  it('serves the uploaded file with X-Content-Type-Options: nosniff (DRB security condition — helmet must cover the static /uploads/* mount)', async () => {
    const boundary = 'boundary7';
    const body = multipartBody(boundary, 'a.jpg', 'image/jpeg', Buffer.from('fake-image-bytes'));
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/v1/uploads/avatars',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    const { url } = uploadRes.json<{ url: string }>();

    const staticRes = await app.inject({ method: 'GET', url });
    expect(staticRes.statusCode).toBe(200);
    expect(staticRes.headers['x-content-type-options']).toBe('nosniff');
  });

  it('applies a dedicated rate limit tighter than the global 300/min', async () => {
    const boundary = 'boundary6';
    const body = multipartBody(boundary, 'a.jpg', 'image/jpeg', Buffer.from('x'));
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    };

    let sawTooManyRequests = false;
    for (let i = 0; i < 25; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/uploads/avatars', headers, payload: body });
      if (res.statusCode === 429) {
        sawTooManyRequests = true;
        break;
      }
      expect(res.statusCode).toBe(201);
    }
    expect(sawTooManyRequests).toBe(true);
  });
});
