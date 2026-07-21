// Build-stage TDD coverage for spec-WI-044 — Dropdown must not call the consumer's
// onOpenChange synchronously from inside the setOpen functional updater (which trips
// React's "Cannot update a component while rendering a different component" warning).
// onOpenChange must instead fire from a commit-phase effect / real event handler, exactly
// once per net open/close transition, never on mount, and never via setTimeout/rAF.
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dropdown, DropdownItem } from './dropdown';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDropdown(onOpenChange?: (open: boolean) => void) {
  return render(
    <Dropdown trigger={<span>Bell</span>} onOpenChange={onOpenChange}>
      <DropdownItem onSelect={() => {}}>Item</DropdownItem>
    </Dropdown>,
  );
}

describe('Dropdown — onOpenChange timing (WI-044)', () => {
  it('does not warn about updating a component while rendering a different component when opened', async () => {
    // Reproduces this app's actual runtime conditions: apps/web/next.config.ts sets
    // reactStrictMode: true, and React only double-invokes the setOpen functional updater
    // (surfacing the render-phase violation as a console.error) under StrictMode — a plain
    // (non-StrictMode) render of the buggy implementation does not reproduce the warning.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    // Simulate a consumer (e.g. NotificationsMenu) whose onOpenChange updates its own state.
    function Consumer() {
      const [, setOpened] = useState(false);
      return (
        <Dropdown
          trigger={<span>Bell</span>}
          onOpenChange={(open: boolean) => {
            if (open) setOpened(true);
          }}
        >
          <DropdownItem onSelect={() => {}}>Item</DropdownItem>
        </Dropdown>
      );
    }
    render(
      <StrictMode>
        <Consumer />
      </StrictMode>,
    );
    await user.click(screen.getByRole('button'));

    const badWarning = errorSpy.mock.calls.some((args) =>
      args.some(
        (a) =>
          typeof a === 'string' &&
          a.includes('Cannot update a component') &&
          a.includes('while rendering a different component'),
      ),
    );
    expect(badWarning).toBe(false);
    errorSpy.mockRestore();
  });

  it('does not call onOpenChange on mount', () => {
    const onOpenChange = vi.fn();
    renderDropdown(onOpenChange);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('does not call onOpenChange on mount under StrictMode (dev double-invokes effects)', () => {
    // apps/web/next.config.ts sets reactStrictMode: true, so React double-invokes
    // (mount -> cleanup -> mount) effects on initial mount in dev. A naive "first-run ref"
    // guard without a cleanup would misfire onOpenChange(false) on the second invocation.
    const onOpenChange = vi.fn();
    render(
      <StrictMode>
        <Dropdown trigger={<span>Bell</span>} onOpenChange={onOpenChange}>
          <DropdownItem onSelect={() => {}}>Item</DropdownItem>
        </Dropdown>
      </StrictMode>,
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('calls onOpenChange(true) once on trigger click, and onOpenChange(false) once on a second click', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDropdown(onOpenChange);
    const trigger = screen.getByRole('button');

    await user.click(trigger);
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(trigger);
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('calls onOpenChange via Enter/Space keypress on the trigger', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDropdown(onOpenChange);
    const trigger = screen.getByRole('button');
    trigger.focus();

    await user.keyboard('{Enter}');
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    await user.keyboard(' ');
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('calls onOpenChange(false) on outside click', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <div>
        <Dropdown trigger={<span>Bell</span>} onOpenChange={onOpenChange}>
          <DropdownItem onSelect={() => {}}>Item</DropdownItem>
        </Dropdown>
        <button type="button">outside</button>
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Bell' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    await user.click(screen.getByRole('button', { name: 'outside' }));
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('calls onOpenChange(false) on Escape key while open', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDropdown(onOpenChange);
    await user.click(screen.getByRole('button'));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('calls onOpenChange(false) when a DropdownItem is selected via close()', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDropdown(onOpenChange);
    await user.click(screen.getByRole('button'));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    await user.click(screen.getByRole('menuitem', { name: 'Item' }));
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does not double-fire or drift out of sync when two clicks land in the same batch', () => {
    const onOpenChange = vi.fn();
    renderDropdown(onOpenChange);
    const trigger = screen.getByRole('button');

    // Both clicks read the same (pre-rerender) `open` closure value within one batch, so they
    // compute the same next value — this should settle to exactly one net transition, and
    // onOpenChange should fire exactly once, matching the final committed `open` state.
    act(() => {
      fireEvent.click(trigger);
      fireEvent.click(trigger);
    });

    const isOpen = screen.queryByRole('menu') !== null;
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenLastCalledWith(isOpen);
  });

  it('UserMenu-style usage with no onOpenChange prop is a safe no-op', async () => {
    const user = userEvent.setup();
    render(
      <Dropdown trigger={<span>User</span>}>
        <DropdownItem onSelect={() => {}}>Logout</DropdownItem>
      </Dropdown>,
    );
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByRole('button'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
