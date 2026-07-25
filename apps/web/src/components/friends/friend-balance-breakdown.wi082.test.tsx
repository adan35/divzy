// spec-WI-082 — CSS hairline tree connectors for the per-group breakdown.
//
// Focuses on the shared FriendBalanceBreakdown component in isolation:
// no text glyphs, dedicated connector hooks, terminal-elbow semantics,
// overflow-toggle participation, sub-line rail continuity, and token/a11y
// compliance. Because the dashboard consumes the same component, these
// assertions cover both surfaces.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FriendBalanceBucket, FriendDto } from '@divzy/shared';
import { FriendBalanceBreakdown } from './friend-balance-breakdown';

vi.mock('next/link', () => ({
  default: function MockLink({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) {
    return <a {...props}>{children}</a>;
  },
}));

function fixtureFriend(overrides: Partial<FriendDto> = {}): FriendDto {
  return {
    user: { id: 'friend-1', name: 'Priya Owe', avatarColor: '#111' },
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
    balancesByGroup: [],
    lastActivityAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function fixtureBucket(overrides: Partial<FriendBalanceBucket> = {}): FriendBalanceBucket {
  return {
    group: null,
    balances: [],
    balancesNative: [],
    balancesConverted: null,
    usedFallbackRates: false,
    ...overrides,
  };
}

function panelFor(label: string): HTMLElement {
  const link = screen.getByRole('link', { name: new RegExp(label, 'i') });
  const panel = link.closest('[class*="divide-y"]');
  if (!panel) throw new Error('breakdown panel not found');
  return panel as HTMLElement;
}

describe('FriendBalanceBreakdown — WI-082 hairline connectors', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders no tree text glyphs and no font-mono prefix class', () => {
    render(
      <FriendBalanceBreakdown
        friend={fixtureFriend({
          balancesByGroup: [
            fixtureBucket({
              group: { id: 'g1', name: 'Alpha', emoji: 'A' },
              balancesNative: [{ currency: 'USD', amount: 100 }],
              balancesConverted: { currency: 'USD', amount: 100 },
            }),
            fixtureBucket({
              group: { id: 'g2', name: 'Beta', emoji: 'B' },
              balancesNative: [{ currency: 'USD', amount: 200 }],
              balancesConverted: { currency: 'USD', amount: 200 },
            }),
          ],
        })}
      />,
    );

    const panel = panelFor('Alpha');
    expect(panel.textContent).not.toMatch(/[├└─|_]/);
    expect(panel.querySelector('.font-mono')).toBeNull();
  });

  it('renders one aria-hidden connector per visible bucket line; non-last mid, last terminal', () => {
    render(
      <FriendBalanceBreakdown
        friend={fixtureFriend({
          balancesByGroup: [
            fixtureBucket({
              group: { id: 'g1', name: 'Alpha', emoji: 'A' },
              balancesNative: [{ currency: 'USD', amount: 100 }],
              balancesConverted: { currency: 'USD', amount: 100 },
            }),
            fixtureBucket({
              group: { id: 'g2', name: 'Beta', emoji: 'B' },
              balancesNative: [{ currency: 'USD', amount: 200 }],
              balancesConverted: { currency: 'USD', amount: 200 },
            }),
            fixtureBucket({
              group: { id: 'g3', name: 'Gamma', emoji: 'G' },
              balancesNative: [{ currency: 'USD', amount: 300 }],
              balancesConverted: { currency: 'USD', amount: 300 },
            }),
          ],
        })}
      />,
    );

    const connectors = screen.getAllByTestId('tree-connector');
    expect(connectors).toHaveLength(3);

    connectors.forEach((connector) => {
      expect(connector).toHaveAttribute('aria-hidden', 'true');
      expect(connector).not.toHaveAttribute('role');
      expect(connector).not.toHaveAttribute('tabindex');
    });

    expect(connectors[0]).toHaveAttribute('data-connector', 'mid');
    expect(connectors[1]).toHaveAttribute('data-connector', 'mid');
    expect(connectors[2]).toHaveAttribute('data-connector', 'terminal');
  });

  it('uses the border-hairline token and declares no literal hex color', () => {
    render(
      <FriendBalanceBreakdown
        friend={fixtureFriend({
          balancesByGroup: [
            fixtureBucket({
              group: { id: 'g1', name: 'Alpha', emoji: 'A' },
              balancesNative: [{ currency: 'USD', amount: 100 }],
              balancesConverted: { currency: 'USD', amount: 100 },
            }),
            fixtureBucket({
              group: { id: 'g2', name: 'Beta', emoji: 'B' },
              balancesNative: [{ currency: 'USD', amount: 200 }],
              balancesConverted: { currency: 'USD', amount: 200 },
            }),
          ],
        })}
      />,
    );

    const connectors = screen.getAllByTestId('tree-connector');
    connectors.forEach((connector) => {
      expect(connector.className).toContain('border-hairline');
      expect(connector.className).not.toMatch(/#[0-9a-f]{3,8}/i);
      expect(connector.className).not.toMatch(/rgb\(|hsl\(/i);
    });
  });

  it('does not add extra connector stubs for composition hints or est. rate sub-lines', () => {
    render(
      <FriendBalanceBreakdown
        friend={fixtureFriend({
          balancesByGroup: [
            fixtureBucket({
              group: { id: 'g1', name: 'Verbose', emoji: 'V' },
              balancesNative: [{ currency: 'USD', amount: 100 }],
              balancesConverted: { currency: 'USD', amount: 100 },
              expenseCount: 2,
              settlementCount: 1,
              usedFallbackRates: true,
            }),
            fixtureBucket({
              group: { id: 'g2', name: 'Plain', emoji: 'P' },
              balancesNative: [{ currency: 'USD', amount: 200 }],
              balancesConverted: { currency: 'USD', amount: 200 },
            }),
          ],
        })}
      />,
    );

    // Two bucket lines, two connectors — the hint and est. rate are not lines.
    expect(screen.getAllByTestId('tree-connector')).toHaveLength(2);
    expect(screen.getByText('2 expenses · 1 settlement')).toBeInTheDocument();
    expect(screen.getByText('est. rate')).toBeInTheDocument();
  });

  it('puts the terminal elbow on the overflow toggle when collapsed; shifts it to the last bucket after expand', async () => {
    const user = userEvent.setup();
    const buckets = Array.from({ length: 6 }, (_, i) =>
      fixtureBucket({
        group: { id: `group-${i + 1}`, name: `Group ${i + 1}`, emoji: '👥' },
        balancesNative: [{ currency: 'USD', amount: 100 * (i + 1) }],
        balancesConverted: { currency: 'USD', amount: 100 * (i + 1) },
      }),
    );

    render(<FriendBalanceBreakdown friend={fixtureFriend({ balancesByGroup: buckets })} />);

    const bucketConnectors = screen.getAllByTestId('tree-connector');
    expect(bucketConnectors).toHaveLength(5);
    bucketConnectors.slice(0, 4).forEach((connector) => {
      expect(connector).toHaveAttribute('data-connector', 'mid');
    });

    const toggle = screen.getByRole('button', { name: '+2 more groups' });
    const toggleConnector = within(toggle).getByTestId('tree-connector');
    expect(toggleConnector).toHaveAttribute('data-connector', 'terminal');

    await user.click(toggle);

    const expandedConnectors = screen.getAllByTestId('tree-connector');
    expect(expandedConnectors).toHaveLength(6);
    expandedConnectors.slice(0, 5).forEach((connector) => {
      expect(connector).toHaveAttribute('data-connector', 'mid');
    });
    expect(expandedConnectors[5]).toHaveAttribute('data-connector', 'terminal');
    expect(screen.queryByRole('button', { name: /more groups/ })).not.toBeInTheDocument();
  });

  it('keeps existing bucket-link aria-labels unchanged', () => {
    render(
      <FriendBalanceBreakdown
        friend={fixtureFriend({
          balancesByGroup: [
            fixtureBucket({
              group: { id: 'g-trip', name: 'Trip to Rome', emoji: '🧳' },
              balancesNative: [{ currency: 'USD', amount: 100 }],
              balancesConverted: { currency: 'USD', amount: 100 },
              expenseCount: 1,
              settlementCount: 0,
            }),
            fixtureBucket({
              group: null,
              balancesNative: [{ currency: 'USD', amount: -200 }],
              balancesConverted: { currency: 'USD', amount: -200 },
            }),
          ],
        })}
      />,
    );

    expect(screen.getByRole('link', { name: /Trip to Rome, 1 expense, go to group/i })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Direct \(outside groups\), go to friend details/i }),
    ).toBeInTheDocument();
  });
});
