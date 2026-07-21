// Build-stage TDD coverage for spec-WI-068 §9.1 (`app/providers.tsx` row):
// the sonner Toaster's `richColors` styling is mapped to the design tokens
// via `toastOptions` (success ring `pos`, error ring `neg`/`danger`);
// position/richColors/closeButton stay unchanged (spec: "position
// unchanged"). `next-themes` and `sonner` are mocked wholesale per this
// repo's established convention (see (app)/layout.test.tsx) so this suite
// never needs a real matchMedia-backed ThemeProvider.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Toaster } from 'sonner';
import { Providers } from './providers';

vi.mock('next-themes', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  useTheme: () => ({ resolvedTheme: 'light' }),
}));
vi.mock('@/lib/auth-store', () => ({ initAuth: vi.fn() }));
vi.mock('sonner', () => ({ Toaster: vi.fn(() => null) }));

const mockedToaster = vi.mocked(Toaster);

describe('Providers — WI-068 toaster token mapping', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('keeps richColors, closeButton and bottom-right position unchanged', () => {
    render(<Providers>content</Providers>);
    const props = mockedToaster.mock.calls[0]![0]!;
    expect(props).toMatchObject({
      richColors: true,
      closeButton: true,
      position: 'bottom-right',
    });
  });

  it('maps success/error toast rings to the pos/neg (danger) tokens via toastOptions.classNames', () => {
    render(<Providers>content</Providers>);
    const props = mockedToaster.mock.calls[0]![0]!;
    expect(props.toastOptions?.classNames?.success).toContain('pos');
    expect(props.toastOptions?.classNames?.error).toMatch(/danger|neg/);
  });
});
