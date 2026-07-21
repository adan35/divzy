// Build-stage TDD coverage for spec-WI-068 §9.1 (auth screens row): the auth
// card sits on `elevated`/`shadow-pop` chrome over a `page` background with a
// subtle radial `brand-soft` CSS wash, and the wordmark gets the same
// ink+gold-dot treatment as the nav shell (type-only, no logo change).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useAuth } from '@/lib/auth-store';
import AuthLayout from './layout';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('@/lib/auth-store', () => ({ useAuth: vi.fn() }));

const mockedUseAuth = vi.mocked(useAuth);

describe('AuthLayout — WI-068 chrome', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ status: 'guest' } as unknown as ReturnType<typeof useAuth>);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the auth card on elevated/shadow-pop chrome, not the default surface/shadow-card', () => {
    render(<AuthLayout>form</AuthLayout>);
    const card = screen.getByTestId('auth-card');
    expect(card.className).toContain('bg-elevated');
    expect(card.className).toContain('shadow-pop');
  });

  it('lays a subtle radial brand-soft wash (CSS only) behind the card', () => {
    render(<AuthLayout>form</AuthLayout>);
    const shell = screen.getByTestId('auth-shell');
    expect(shell.style.backgroundImage).toContain('radial-gradient');
    expect(shell.style.backgroundImage).toContain('brand-soft');
  });

  it('wordmark reads ink with a gold "." accent, matching the nav shell treatment', () => {
    render(<AuthLayout>form</AuthLayout>);
    const wordmark = screen.getByText('divzy');
    expect(wordmark.className).toContain('text-ink');
    expect(wordmark.className).not.toContain('text-brand');
    const dot = screen.getByText('.', { selector: 'span' });
    expect(dot.className).toContain('text-accent');
  });
});
