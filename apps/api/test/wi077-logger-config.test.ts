// Regression tests for WI-077: logger verbosity must be gated on the
// explicit LOG_PRETTY opt-in flag, never on NODE_ENV, so a missing or
// misconfigured NODE_ENV fails safe to lean production logging instead of
// silently falling back to the synchronous pino-pretty debug transport.

import { describe, expect, it } from 'vitest';
import { resolveLoggerOptions } from '../src/app';

describe('resolveLoggerOptions (WI-077)', () => {
  it('uses the debug/pino-pretty transport when LOG_PRETTY is true, regardless of NODE_ENV', () => {
    const opts = resolveLoggerOptions({ LOG_PRETTY: true, NODE_ENV: 'production' }) as {
      level: string;
      transport: { target: string };
    };
    expect(opts.level).toBe('debug');
    expect(opts.transport.target).toBe('pino-pretty');
  });

  it('falls back to lean info-level JSON logging when LOG_PRETTY is false, even if NODE_ENV is "development"', () => {
    const opts = resolveLoggerOptions({ LOG_PRETTY: false, NODE_ENV: 'development' }) as {
      level: string;
      transport?: unknown;
    };
    expect(opts.level).toBe('info');
    expect(opts.transport).toBeUndefined();
  });

  it('stays silent in test regardless of LOG_PRETTY', () => {
    const opts = resolveLoggerOptions({ LOG_PRETTY: false, NODE_ENV: 'test' }) as { level: string };
    expect(opts.level).toBe('silent');
  });
});
