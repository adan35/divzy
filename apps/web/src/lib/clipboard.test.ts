// WI-016 Part B — dedicated unit coverage for the shared `copyToClipboard`
// helper (promoted from the pattern already established in
// `components/groups/invite-dialog.tsx`'s local `handleCopy`/
// `copyViaFallback`). Mirrors `invite-dialog.test.tsx`'s scenarios exactly
// (happy path, missing clipboard, writeText not a function, fallback
// failure, writeText rejection) so this shared home carries its own direct
// coverage rather than relying solely on call-site integration tests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from './clipboard';

describe('copyToClipboard', () => {
  let originalClipboard: typeof navigator.clipboard | undefined;
  let originalExecCommand: typeof document.execCommand | undefined;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
    originalExecCommand = document.execCommand;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
      writable: true,
    });
    if (originalExecCommand) document.execCommand = originalExecCommand;
    vi.restoreAllMocks();
  });

  function setClipboard(value: unknown) {
    Object.defineProperty(navigator, 'clipboard', {
      value,
      configurable: true,
      writable: true,
    });
  }

  it('copies via navigator.clipboard.writeText and resolves true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    const ok = await copyToClipboard('hello world');

    expect(writeText).toHaveBeenCalledWith('hello world');
    expect(ok).toBe(true);
  });

  it('falls back to execCommand copy when navigator.clipboard is undefined', async () => {
    setClipboard(undefined);
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    const ok = await copyToClipboard('fallback text');

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(ok).toBe(true);
  });

  it('falls back to execCommand when clipboard.writeText is not a function', async () => {
    setClipboard({});
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    const ok = await copyToClipboard('fallback text 2');

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(ok).toBe(true);
  });

  it('logs and resolves false when the fallback copy also fails (execCommand returns false)', async () => {
    setClipboard(undefined);
    document.execCommand = vi.fn().mockReturnValue(false);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ok = await copyToClipboard('doomed text');

    expect(ok).toBe(false);
    expect(consoleError).toHaveBeenCalledWith('[clipboard] copy failed', expect.any(Error));
  });

  it('logs and resolves false when navigator.clipboard.writeText itself rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('permission denied'));
    setClipboard({ writeText });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ok = await copyToClipboard('rejected text');

    expect(ok).toBe(false);
    expect(consoleError).toHaveBeenCalledWith('[clipboard] copy failed', expect.any(Error));
  });
});
