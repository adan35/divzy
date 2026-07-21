// Build-stage TDD coverage for spec-WI-035 (avatar upload, display slice) —
// Avatar renders a photo when `avatarUrl` is set, resolved through `apiUrl()`,
// and falls back to the initials rendering (never a broken-image icon) both
// when there is no `avatarUrl` and when the `<img>` fails to load.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Avatar, AvatarStack } from './avatar';

vi.mock('@/lib/api', () => ({
  apiUrl: (path: string) => `https://cdn.test${path}`,
}));

afterEach(() => {
  cleanup();
});

describe('Avatar', () => {
  it('renders initials when the user has no avatarUrl', () => {
    render(<Avatar user={{ name: 'Sam Lee', avatarColor: '#2a78d6' }} />);
    expect(screen.getByText('SL')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders initials when avatarUrl is explicitly null', () => {
    render(<Avatar user={{ name: 'Sam Lee', avatarColor: '#2a78d6', avatarUrl: null }} />);
    expect(screen.getByText('SL')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders a photo resolved through apiUrl() when avatarUrl is set', () => {
    render(
      <Avatar
        user={{ name: 'Sam Lee', avatarColor: '#2a78d6', avatarUrl: '/uploads/avatars/abc.jpg' }}
      />,
    );
    const img = screen.getByRole('img', { name: 'Sam Lee' });
    expect(img).toHaveAttribute('src', 'https://cdn.test/uploads/avatars/abc.jpg');
    expect(screen.queryByText('SL')).not.toBeInTheDocument();
  });

  it('falls back to initials (not a broken-image icon) when the photo fails to load', () => {
    render(
      <Avatar
        user={{ name: 'Sam Lee', avatarColor: '#2a78d6', avatarUrl: '/uploads/avatars/abc.jpg' }}
      />,
    );
    const img = screen.getByRole('img', { name: 'Sam Lee' });
    fireEvent.error(img);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('SL')).toBeInTheDocument();
  });
});

describe('AvatarStack', () => {
  it('threads avatarUrl through to each stacked Avatar', () => {
    render(
      <AvatarStack
        users={[
          { name: 'Sam Lee', avatarColor: '#2a78d6', avatarUrl: '/uploads/avatars/abc.jpg' },
          { name: 'Jo Park', avatarColor: '#c0392b' },
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: 'Sam Lee' })).toHaveAttribute(
      'src',
      'https://cdn.test/uploads/avatars/abc.jpg',
    );
    expect(screen.getByText('JP')).toBeInTheDocument();
  });
});
