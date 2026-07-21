// Build-stage TDD coverage for spec-WI-068 §8.2 (chart restyle) as applied to
// the analytics monthly-trend chart. Recharts renders zero-size under jsdom
// (no real layout — confirmed empirically by group-spend-chart.test.tsx /
// spend-snapshot-chart.wi036-snapshot.test.tsx in this same repo), so the
// `<BarChart>`/`<Bar>`/`<CartesianGrid>` SVG internals (chart-1 fill, grid
// stroke, bar radius) are NOT observable via RTL here and are covered by
// source review only (see the build summary's coverage/exclusions note).
// `ChartTooltip`, however, is a plain function component with no Recharts/SVG
// dependency — it is exported so this suite can render and assert its new
// AC-4a (Money component, never bare formatMoney) and §8.2 (elevated tooltip
// chrome) behavior directly and deterministically.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { formatMoney } from '@divzy/shared';
import { ChartTooltip } from './monthly-trend-chart';

describe('ChartTooltip (monthly trend chart)', () => {
  it('renders nothing when inactive', () => {
    const { container } = render(
      <ChartTooltip active={false} payload={[{ value: 4210 }]} label="Mar" currency="USD" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the payload value is not a number', () => {
    const { container } = render(
      <ChartTooltip active payload={[{ value: undefined }]} label="Mar" currency="USD" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the month label and the money value through the shared MoneyText component (AC-4a)', () => {
    render(<ChartTooltip active payload={[{ value: 421099 }]} label="Mar" currency="USD" />);

    expect(screen.getByText('Mar')).toBeInTheDocument();
    const valueEl = screen.getByText(formatMoney(421099, 'USD'));
    // MoneyText's span always carries `tabular-nums` — a bare
    // formatMoney()-into-<p> string would not produce an element with this
    // class on the text node itself.
    expect(valueEl.tagName).toBe('SPAN');
    expect(valueEl.className).toContain('tabular-nums');
  });

  it('uses the elevated/shadow-pop tooltip chrome, not the old surface/shadow-sm chrome (spec §8.2)', () => {
    const { container } = render(
      <ChartTooltip active payload={[{ value: 1000 }]} label="Feb" currency="USD" />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('bg-elevated');
    expect(card.className).toContain('shadow-pop');
    expect(card.className).not.toContain('bg-surface');
    expect(card.className).not.toContain('shadow-sm');
  });
});
