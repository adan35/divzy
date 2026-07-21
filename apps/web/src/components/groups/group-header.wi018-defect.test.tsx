import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupDto } from '@divzy/shared';
import { GroupHeader } from './group-header';

// defect-WI-018 — "web PDF export downloads a corrupted (binary-through-text)
// PDF". Unlike group-header.test.tsx, this file deliberately does NOT mock
// `@/lib/api` — it stubs global `fetch` and lets the real
// `@divzy/api-client` client.ts + http.ts code run, because the corrupting
// layer (HttpClient's response decode) is exactly what a mocked api module
// hides (per review-WI-018 §"Why no test caught it").

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// WI-051: GroupHeader now calls useRouter() directly (back-to-groups-list
// button) — must be mocked or render() throws "invariant expected app router
// to be mounted". Dedicated router-behavior assertions live in
// group-header.wi051-back-button.test.tsx; this mock exists here only so
// this file's pre-existing (unrelated) test keeps rendering.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

function fixtureGroup(overrides: Partial<GroupDto> = {}): GroupDto {
  return {
    id: 'group-1',
    name: 'Roomies',
    emoji: '🏠',
    type: 'HOME',
    currency: 'USD',
    inviteCode: 'ABCDEFGHIJ',
    simplifyDebts: true,
    createdBy: { id: 'user-1', name: 'Sam Lee', avatarColor: '#000' },
    members: [
      {
        user: { id: 'user-1', name: 'Sam Lee', avatarColor: '#000' },
        role: 'ADMIN',
        joinedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function noop() {
  /* not exercised in these assertions */
}

/** jsdom's Blob implementation doesn't have arrayBuffer()/text() (unlike a
 * real browser or Node's Blob) — FileReader is the one byte-reading API
 * jsdom does support, so use that to read the downloaded Blob back out. */
function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** Every byte value 0x00-0xff, repeated — the way a real pdfkit
 * FlateDecode-compressed stream contains arbitrary binary bytes that are
 * not valid UTF-8. This is what response.text() would corrupt. */
function realisticBinaryPdfBuffer(): Uint8Array {
  const header = new TextEncoder().encode('%PDF-1.3\n');
  const allBytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) allBytes[i] = i;
  const repeated = new Uint8Array(allBytes.length * 8);
  for (let i = 0; i < 8; i++) repeated.set(allBytes, i * allBytes.length);
  const footer = new TextEncoder().encode('\n%%EOF');
  const out = new Uint8Array(header.length + repeated.length + footer.length);
  out.set(header, 0);
  out.set(repeated, header.length);
  out.set(footer, header.length + repeated.length);
  return out;
}

describe('GroupHeader — Export PDF real transport (defect-WI-018 regression)', () => {
  let original: Uint8Array;
  let fetchMock: ReturnType<typeof vi.fn>;
  let createObjectURLSpy: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    original = realisticBinaryPdfBuffer();
    fetchMock = vi.fn(
      async () =>
        new Response(original, {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    createObjectURLSpy = vi.fn(() => 'blob:mock-url');
    URL.createObjectURL = createObjectURLSpy as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('downloads a byte-identical PDF through the real client.ts + http.ts transport, no U+FFFD corruption', async () => {
    const user = userEvent.setup();
    render(
      <GroupHeader
        group={fixtureGroup()}
        isAdmin
        onSettleUp={noop}
        onInvite={noop}
        onEdit={noop}
        onArchive={noop}
        onLeave={noop}
        onDelete={noop}
      />,
    );

    await user.click(screen.getByRole('button', { name: /group settings/i }));
    await user.click(screen.getByRole('menuitem', { name: /export pdf/i }));

    await waitFor(() => expect(createObjectURLSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));

    const blobArg = createObjectURLSpy.mock.calls[0]?.[0] as Blob;
    expect(blobArg).toBeInstanceOf(Blob);
    // jsdom's Blob doesn't implement arrayBuffer()/text(), so read it back
    // via FileReader (which jsdom does support) instead.
    const downloadedBytes = new Uint8Array(await readBlobAsArrayBuffer(blobArg));

    expect(downloadedBytes.length).toBe(original.length);
    expect(Array.from(downloadedBytes)).toEqual(Array.from(original));

    // Sanity: prove this fixture really would have been corrupted by the
    // old text-decoding path, so a false negative isn't possible here.
    const wouldHaveBeenCorrupted = new TextDecoder('utf-8').decode(original);
    expect(wouldHaveBeenCorrupted).toContain('�');
  });
});
