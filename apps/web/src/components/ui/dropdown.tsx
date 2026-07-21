'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

interface DropdownContextValue {
  close: () => void;
}

const DropdownContext = createContext<DropdownContextValue | null>(null);

export interface DropdownProps {
  /** Element that toggles the menu (rendered inside an accessible wrapper). */
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
  side?: 'top' | 'bottom';
  contentClassName?: string;
  className?: string;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Click-outside dropdown menu with Esc handling. */
export function Dropdown({
  trigger,
  children,
  align = 'end',
  side = 'bottom',
  contentClassName,
  className,
  disabled,
  onOpenChange,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  // Tracks the previously-committed `open` value so the effect below only notifies on a
  // real open/close transition (reproducing the old `prev !== next` guard), never on mount
  // (initialized to the same value as the initial `open` state). Comparing against a ref
  // — rather than a "did this effect run before" flag reset in a cleanup — is robust to
  // React StrictMode's dev-only mount -> cleanup -> re-mount effect double-invocation: a
  // cleanup-driven flag would get reset by the *real* cleanup that also runs before every
  // later dependency-change re-run, causing false skips on genuine transitions.
  const prevOpenRef = useRef(open);

  // Notify the consumer from a commit-phase effect (never from inside the setOpen
  // functional updater) so this never fires while React is mid-render of a different
  // component.
  useEffect(() => {
    if (prevOpenRef.current !== open) {
      onOpenChangeRef.current?.(open);
    }
    prevOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!disabled) setOpen(!open);
    }
  };

  return (
    <div ref={rootRef} className={cn('relative inline-block', className)}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (!disabled) setOpen(!open);
        }}
        onKeyDown={onTriggerKeyDown}
        className={cn('cursor-pointer', disabled && 'cursor-not-allowed opacity-55')}
      >
        {trigger}
      </div>
      {open && (
        <div
          role="menu"
          className={cn(
            'animate-pop-in absolute z-50 min-w-[180px] overflow-hidden rounded-xl border border-hairline bg-elevated py-1 shadow-pop dark:shadow-top-edge',
            side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
            align === 'end' ? 'right-0' : 'left-0',
            contentClassName,
          )}
        >
          <DropdownContext.Provider value={{ close: () => setOpen(false) }}>
            {children}
          </DropdownContext.Provider>
        </div>
      )}
    </div>
  );
}

export interface DropdownItemProps {
  onSelect?: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** Keep the menu open after selecting (rare). */
  keepOpen?: boolean;
  className?: string;
  children: ReactNode;
}

export function DropdownItem({
  onSelect,
  icon,
  danger,
  disabled,
  keepOpen,
  className,
  children,
}: DropdownItemProps) {
  const ctx = useContext(DropdownContext);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onSelect?.();
        if (!keepOpen) ctx?.close();
      }}
      className={cn(
        'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors',
        danger ? 'text-danger hover:bg-neg-soft' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
        className,
      )}
    >
      {icon && (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-4 [&>svg]:w-4">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export function DropdownSeparator({ className }: { className?: string }) {
  return <div role="separator" className={cn('my-1 h-px bg-hairline', className)} />;
}

export function DropdownLabel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-ink-3', className)}
      {...props}
    />
  );
}
