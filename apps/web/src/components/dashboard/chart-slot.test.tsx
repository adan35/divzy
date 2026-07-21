import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardChartSlot } from './chart-slot';

// WI-036 (notifications-activity slice): the layout-slot contract for
// analytics' compact spend chart — spec-WI-036 §2-3. This component owns
// ONLY placement + a fixed max-height; it takes no props threaded from the
// activity feed and does no data-fetching of its own.

describe('DashboardChartSlot', () => {
  it('renders a labeled, bounded-height section even with no chart delivered yet (placeholder)', () => {
    render(<DashboardChartSlot />);
    const section = screen.getByLabelText('Spend chart');
    expect(section).toBeInTheDocument();
    expect(section.className).toMatch(/max-h-/);
  });

  it('renders analytics-supplied children inside the bounded section, unmodified', () => {
    render(
      <DashboardChartSlot>
        <div data-testid="analytics-chart">chart content</div>
      </DashboardChartSlot>,
    );
    expect(screen.getByTestId('analytics-chart')).toBeInTheDocument();
    // The slot never wraps/restyles the child beyond its own bounded container.
    expect(screen.getByLabelText('Spend chart')).toContainElement(
      screen.getByTestId('analytics-chart'),
    );
  });
});
