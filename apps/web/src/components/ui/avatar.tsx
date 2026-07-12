'use client';

import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface AvatarUser {
  name: string;
  avatarColor: string;
}

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

export interface AvatarProps {
  user: AvatarUser;
  size?: AvatarSize;
  className?: string;
}

const SIZES: Record<AvatarSize, string> = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-9 w-9 text-[13px]',
  lg: 'h-12 w-12 text-base',
};

/** Colored circle + white initials (color comes from `user.avatarColor`). */
export function Avatar({ user, size = 'md', className }: AvatarProps) {
  return (
    <span
      title={user.name}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white',
        SIZES[size],
        className,
      )}
      style={{ backgroundColor: user.avatarColor }}
    >
      {initials(user.name)}
    </span>
  );
}

export interface AvatarStackProps {
  users: AvatarUser[];
  size?: AvatarSize;
  /** Collapse beyond this many into a "+n" bubble. */
  max?: number;
  className?: string;
}

export function AvatarStack({ users, size = 'sm', max = 4, className }: AvatarStackProps) {
  const visible = users.slice(0, max);
  const overflow = users.length - visible.length;
  return (
    <span className={cn('inline-flex items-center -space-x-2', className)}>
      {visible.map((user, i) => (
        <Avatar
          key={`${user.name}-${i}`}
          user={user}
          size={size}
          className="ring-2 ring-surface"
        />
      ))}
      {overflow > 0 && (
        <span
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full bg-surface-2 font-medium text-ink-2 ring-2 ring-surface',
            SIZES[size],
          )}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}
