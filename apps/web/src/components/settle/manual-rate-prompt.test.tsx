import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@divzy/api-client';
import { ManualRatePrompts } from './manual-rate-prompt';
import { useCreateManualRate } from '@/lib/hooks';

vi.mock('@/lib/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks')>();
  return { ...actual, useCreateManualRate: vi.fn() };
});

const mockedUseCreateManualRate = vi.mocked(useCreateManualRate);

function mockMutationState(overrides: Partial<ReturnType<typeof useCreateManualRate>> = {}) {
  const mutate = vi.fn();
  mockedUseCreateManualRate.mockReturnValue({
    mutate,
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useCreateManualRate>);
  return mutate;
}

describe('ManualRatePrompts', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('prompts once for an unresolved currency pair, asking "1 X = ? Y"', () => {
    mockMutationState();
    render(
      <ManualRatePrompts
        unresolved={[{ currency: 'USD', amount: 1200 }]}
        viewerCurrency="PKR"
        onResolved={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('1 USD = ? PKR')).toBeInTheDocument();
  });

  it('WI-068 §9.1: pairs the warning copy with an icon inside a warn-soft banner (never color/text alone)', () => {
    mockMutationState();
    render(
      <ManualRatePrompts
        unresolved={[{ currency: 'USD', amount: 1200 }]}
        viewerCurrency="PKR"
        onResolved={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    const banner = within(dialog).getByTestId('manual-rate-warning');
    expect(banner.className).toContain('bg-warn-soft');
    expect(banner.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('never opens a second dialog for the same pair within the session', () => {
    mockMutationState();
    const { rerender } = render(
      <ManualRatePrompts
        unresolved={[{ currency: 'USD', amount: 1200 }]}
        viewerCurrency="PKR"
        onResolved={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    // Re-render with the identical unresolved list (simulating a re-render
    // before the user responds) — still exactly one dialog.
    rerender(
      <ManualRatePrompts
        unresolved={[{ currency: 'USD', amount: 1200 }]}
        viewerCurrency="PKR"
        onResolved={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('dismissing leaves the pair marked shown-this-session — remounting does not re-prompt', async () => {
    mockMutationState();
    const user = userEvent.setup();
    const { unmount } = render(
      <ManualRatePrompts
        unresolved={[{ currency: 'USD', amount: 1200 }]}
        viewerCurrency="PKR"
        onResolved={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Dismiss without submitting.
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    unmount();

    // A fresh mount within the same session (sessionStorage persists) must
    // not re-open the prompt for the same still-unresolved pair.
    render(
      <ManualRatePrompts
        unresolved={[{ currency: 'USD', amount: 1200 }]}
        viewerCurrency="PKR"
        onResolved={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('rejects a non-positive/non-numeric entry locally, without calling the API', async () => {
    const mutate = mockMutationState();
    const user = userEvent.setup();
    render(
      <ManualRatePrompts
        unresolved={[{ currency: 'USD', amount: 1200 }]}
        viewerCurrency="PKR"
        onResolved={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), '-5');
    await user.click(within(dialog).getByRole('button', { name: 'Save rate' }));

    expect(mutate).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/greater than zero/i);
  });

  it('submits a valid rate, then closes and triggers onResolved', async () => {
    const onResolved = vi.fn();
    const mutate = mockMutationState();
    mutate.mockImplementation((_vars, opts) => opts?.onSuccess?.());
    const user = userEvent.setup();
    render(
      <ManualRatePrompts
        unresolved={[{ currency: 'USD', amount: 1200 }]}
        viewerCurrency="PKR"
        onResolved={onResolved}
      />,
    );

    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), '278.5');
    await user.click(within(dialog).getByRole('button', { name: 'Save rate' }));

    expect(mutate).toHaveBeenCalledWith(
      { from: 'USD', to: 'PKR', rate: 278.5 },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the server error inline and keeps the prompt open on a 4xx', async () => {
    mockMutationState({
      isError: true,
      error: new ApiError(400, 'from and to must be different currencies', 'VALIDATION_ERROR'),
    } as Partial<ReturnType<typeof useCreateManualRate>>);
    render(
      <ManualRatePrompts
        unresolved={[{ currency: 'USD', amount: 1200 }]}
        viewerCurrency="PKR"
        onResolved={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'from and to must be different currencies',
    );
  });
});
