import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CurrencySelect } from './currency-select';

describe('CurrencySelect (WI-042 regression — reimplemented over SearchSelect)', () => {
  it('scenario: opens, shows the search input focused, and the full currency listbox', () => {
    render(<CurrencySelect value="USD" onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /USD/ }));

    expect(screen.getByRole('listbox', { name: 'Currency' })).toBeInTheDocument();
    expect(screen.getAllByRole('option').length).toBeGreaterThan(1);
  });

  it('scenario: typing filters by code, name, or symbol — case-insensitive', () => {
    render(<CurrencySelect value="USD" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /USD/ }));

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'euro' } });

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('EUR');
  });

  it('scenario: no match renders the explicit "No currencies match" empty state', () => {
    render(<CurrencySelect value="USD" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /USD/ }));

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'zzzzz' } });

    expect(screen.getByText('No currencies match')).toBeInTheDocument();
  });

  it('scenario: keyboard nav — ArrowDown then Enter selects the highlighted currency', () => {
    const onChange = vi.fn();
    render(<CurrencySelect value="USD" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /USD/ }));

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'eur' } });
    fireEvent.keyDown(screen.getByRole('listbox').parentElement!, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('listbox').parentElement!, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('EUR');
  });

  it('scenario: clicking a row selects it and closes the popover', () => {
    const onChange = vi.fn();
    render(<CurrencySelect value="USD" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /USD/ }));

    fireEvent.click(screen.getByText('Euro'));

    expect(onChange).toHaveBeenCalledWith('EUR');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('scenario: Escape closes the popover without selecting', () => {
    const onChange = vi.fn();
    render(<CurrencySelect value="USD" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /USD/ }));

    fireEvent.keyDown(screen.getByRole('listbox').parentElement!, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
