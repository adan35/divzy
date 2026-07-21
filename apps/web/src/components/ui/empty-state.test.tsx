// WI-068 S1 (web foundation) — EmptyState gains an additive, optional `icon`
// prop (lucide icons over emoji per the pro-rules quality bar); the existing
// `emoji` prop stays back-compat and keeps rendering (screen slices migrate
// opportunistically).
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sparkles } from 'lucide-react';
import { EmptyState } from './empty-state';

describe('EmptyState (WI-068 additive icon prop)', () => {
  it('back-compat: emoji callers keep rendering emoji + title + hint + action', () => {
    render(
      <EmptyState
        emoji="🧾"
        title="No expenses yet"
        hint="Add your first expense"
        action={<button type="button">Add</button>}
      />,
    );
    expect(screen.getByText('🧾')).toBeInTheDocument();
    expect(screen.getByText('No expenses yet')).toBeInTheDocument();
    expect(screen.getByText('Add your first expense')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('renders a provided icon node (emoji omitted)', () => {
    render(
      <EmptyState
        icon={<Sparkles data-testid="es-icon" aria-hidden="true" />}
        title="All settled"
      />,
    );
    expect(screen.getByTestId('es-icon')).toBeInTheDocument();
    expect(screen.getByText('All settled')).toBeInTheDocument();
  });

  it('prefers icon over emoji when both are passed', () => {
    render(
      <EmptyState
        icon={<Sparkles data-testid="es-icon" aria-hidden="true" />}
        emoji="🧾"
        title="Nothing here"
      />,
    );
    expect(screen.getByTestId('es-icon')).toBeInTheDocument();
    expect(screen.queryByText('🧾')).not.toBeInTheDocument();
  });
});
