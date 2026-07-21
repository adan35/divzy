import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../src/http';
import { ApiError } from '../src/errors';

// defect-WI-018 — routing a binary (PDF) response through the text-decoding
// path corrupts it: response.text() UTF-8-decodes bytes that aren't valid
// UTF-8 into U+FFFD replacement characters, and the byte length changes.
// requestBlob() must preserve the bytes exactly, byte-for-byte.

/** A buffer that exercises every byte value 0x00-0xff, the way a real
 * pdfkit FlateDecode-compressed stream would contain arbitrary binary
 * bytes that are not valid UTF-8 sequences. */
function realisticBinaryPdfLikeBuffer(): Buffer {
  const header = Buffer.from('%PDF-1.3\n%\xE2\xE3\xCF\xD3\n', 'binary');
  const allBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  const repeated = Buffer.concat(Array.from({ length: 8 }, () => allBytes));
  return Buffer.concat([header, repeated, Buffer.from('\n%%EOF')]);
}

function makeClient(fetchFn: typeof fetch): HttpClient {
  return new HttpClient({
    baseUrl: 'http://localhost:4000',
    getAccessToken: () => 'token-123',
    credentials: 'omit',
    fetchFn,
  });
}

describe('HttpClient#requestBlob — binary transport (defect-WI-018)', () => {
  it('round-trips real binary content byte-for-byte, unlike the text-decoding request() path', async () => {
    const original = realisticBinaryPdfLikeBuffer();
    const fetchFn = vi.fn(
      async () =>
        new Response(original, {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        }),
    );
    const client = makeClient(fetchFn as unknown as typeof fetch);

    const blob = await client.requestBlob('GET', '/api/v1/groups/g1/export.pdf');
    const roundTripped = Buffer.from(await blob.arrayBuffer());

    expect(roundTripped.length).toBe(original.length);
    expect(roundTripped.equals(original)).toBe(true);

    // Sanity check that this buffer really would be corrupted by the old
    // text-decoding path, i.e. this is a meaningful regression fixture.
    const decodedThenReencoded = Buffer.from(
      new TextDecoder('utf-8').decode(original),
      'utf-8',
    );
    expect(decodedThenReencoded.equals(original)).toBe(false);
    expect(new TextDecoder('utf-8').decode(original)).toContain('�');
  });

  it('does not introduce any U+FFFD replacement characters when decoded back to bytes', async () => {
    const original = realisticBinaryPdfLikeBuffer();
    const fetchFn = vi.fn(
      async () =>
        new Response(original, {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        }),
    );
    const client = makeClient(fetchFn as unknown as typeof fetch);

    const blob = await client.requestBlob('GET', '/api/v1/groups/g1/export.pdf');
    const roundTripped = Buffer.from(await blob.arrayBuffer());

    // Byte-identity (asserted above) already implies this, but assert the
    // symptom directly too since it's what the defect report measured.
    const replacementCount = roundTripped.filter((_, i) => {
      return roundTripped[i] === 0xef && roundTripped[i + 1] === 0xbf && roundTripped[i + 2] === 0xbd;
    }).length;
    expect(replacementCount).toBe(0);
  });

  it('throws a decoded ApiError (not a corrupted blob) on a non-ok binary-endpoint response', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'not found', code: 'NOT_FOUND' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const client = makeClient(fetchFn as unknown as typeof fetch);

    await expect(client.requestBlob('GET', '/api/v1/groups/g1/export.pdf')).rejects.toMatchObject({
      statusCode: 404,
      message: 'not found',
      code: 'NOT_FOUND',
    });
  });
});

describe('HttpClient#request — text/JSON path unaffected by the requestBlob refactor', () => {
  it('still decodes JSON responses as before', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const client = makeClient(fetchFn as unknown as typeof fetch);

    const result = await client.request<{ ok: boolean }>('GET', '/api/v1/health');
    expect(result).toEqual({ ok: true });
  });

  it('still decodes text (e.g. CSV) responses as before', async () => {
    const csv = 'name,amount\nAlice,10.00\n';
    const fetchFn = vi.fn(
      async () =>
        new Response(csv, {
          status: 200,
          headers: { 'content-type': 'text/csv' },
        }),
    );
    const client = makeClient(fetchFn as unknown as typeof fetch);

    const result = await client.request<string>('GET', '/api/v1/groups/g1/export.csv');
    expect(result).toBe(csv);
  });

  it('still throws ApiError with the decoded message on a non-ok response', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: 'forbidden', code: 'FORBIDDEN' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const client = makeClient(fetchFn as unknown as typeof fetch);

    await expect(client.request('GET', '/api/v1/groups/g1')).rejects.toBeInstanceOf(ApiError);
  });
});
