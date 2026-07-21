'use client';

import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  size?: DialogSize;
  /** Accessible name when the dialog has no visible DialogTitle. */
  ariaLabel?: string;
  /** Hide the built-in top-right close button. */
  hideClose?: boolean;
  /** Block overlay-click/Esc dismissal (e.g. while a save is in flight). */
  dismissible?: boolean;
}

const SIZES: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * Accessible modal: portal, blurred overlay, Esc + overlay-click dismissal,
 * focus trap (lite), body scroll lock, focus restoration on close.
 */
export function Dialog({
  open,
  onOpenChange,
  children,
  size = 'md',
  ariaLabel,
  hideClose = false,
  dismissible = true,
}: DialogProps) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the dialog once the panel is in the DOM.
    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const autofocus = panel.querySelector<HTMLElement>('[autofocus], [data-autofocus]');
      const target = autofocus ?? getFocusable(panel)[0] ?? panel;
      target.focus({ preventScroll: true });
    }, 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dismissibleRef.current) {
          e.stopPropagation();
          onOpenChangeRef.current(false);
        }
        return;
      }
      if (e.key !== 'Tab') return;
      // Focus trap (lite): wrap Tab within the panel.
      const focusables = getFocusable(panelRef.current);
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !panelRef.current?.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !panelRef.current?.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!mounted || !open) return null;

  const onOverlayMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (dismissible && e.target === e.currentTarget) onOpenChange(false);
  };

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="animate-fade-in absolute inset-0 bg-overlay backdrop-blur-[2px]" aria-hidden="true" />
      <div
        className="absolute inset-0 overflow-y-auto"
        onMouseDown={onOverlayMouseDown}
      >
        <div
          className="flex min-h-full items-end justify-center p-0 sm:items-center sm:p-4"
          onMouseDown={onOverlayMouseDown}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            tabIndex={-1}
            onMouseDown={(e) => e.stopPropagation()}
            className={cn(
              'animate-pop-in relative w-full rounded-t-xl2 border border-hairline bg-elevated shadow-pop focus:outline-none dark:shadow-top-edge sm:rounded-xl2',
              'max-h-[92dvh] overflow-y-auto',
              SIZES[size],
            )}
          >
            {!hideClose && (
              <button
                type="button"
                aria-label="Close dialog"
                onClick={() => onOpenChange(false)}
                className="absolute right-3.5 top-3.5 z-10 rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <X size={18} aria-hidden="true" />
              </button>
            )}
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('space-y-1 px-5 pb-3 pt-5 pr-12', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-lg font-semibold tracking-tight text-ink', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-ink-2', className)} {...props} />;
}

export function DialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-2', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center justify-end gap-2 px-5 pb-5 pt-4', className)}
      {...props}
    />
  );
}
