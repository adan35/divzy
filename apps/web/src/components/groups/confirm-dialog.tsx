'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One-line consequence of confirming. */
  description?: string;
  confirmLabel?: string;
  /** Renders the confirm button in the danger style. */
  destructive?: boolean;
  /** Disables dismissal and shows a spinner while the action runs. */
  loading?: boolean;
  onConfirm: () => void;
}

/** Small confirmation modal for destructive/irreversible group actions. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      ariaLabel={title}
      dismissible={!loading}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      {description && (
        <DialogBody>
          <p className="text-sm text-ink-2">{description}</p>
        </DialogBody>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant={destructive ? 'danger' : 'primary'}
          loading={loading}
          onClick={onConfirm}
          data-autofocus
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
