import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockAuth = vi.hoisted(() => ({ current: {} }));

vi.mock('../context/AuthProvider', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => mockAuth.current,
}));

vi.mock('../context/ThemeProvider', () => ({
  useTheme: () => ({ isDark: false, toggleTheme: vi.fn() }),
}));

import Layout from '../components/Layout';

describe('Impersonation UI Banner (Layout)', () => {
  beforeEach(() => {
    mockAuth.current = {
      user: { id: 1, email: 'target@library.com', role: 'user' },
      isImpersonating: true,
      impersonator: { id: 9, email: 'admin@library.com', role: 'admin' },
      stopImpersonation: vi.fn().mockResolvedValue({ id: 9, email: 'admin@library.com' }),
      logout: vi.fn(),
      isAdmin: false,
    };
  });

  it('renders top banner stating "Currently Impersonating <user>" when impersonating', () => {
    render(
      <MemoryRouter>
        <Layout>
          <div>Page Content</div>
        </Layout>
      </MemoryRouter>
    );

    const alertBanner = screen.getByRole('alert');
    expect(alertBanner).toBeInTheDocument();
    expect(alertBanner).toHaveTextContent('Currently Impersonating target@library.com');
    expect(screen.getByRole('button', { name: /Switch back to main profile/i })).toBeInTheDocument();
  });

  it('invokes stopImpersonation when clicking "Switch back to main profile"', () => {
    render(
      <MemoryRouter>
        <Layout>
          <div>Page Content</div>
        </Layout>
      </MemoryRouter>
    );

    const switchBtn = screen.getByRole('button', { name: /Switch back to main profile/i });
    fireEvent.click(switchBtn);

    expect(mockAuth.current.stopImpersonation).toHaveBeenCalledTimes(1);
  });

  it('does not render top banner when not impersonating', () => {
    mockAuth.current.isImpersonating = false;

    render(
      <MemoryRouter>
        <Layout>
          <div>Page Content</div>
        </Layout>
      </MemoryRouter>
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Currently Impersonating/i)).not.toBeInTheDocument();
  });
});

describe('Admin tab visibility (Layout)', () => {
  const base = {
    stopImpersonation: vi.fn(),
    logout: vi.fn(),
  };

  const renderNav = () =>
    render(
      <MemoryRouter>
        <Layout>
          <div>Page Content</div>
        </Layout>
      </MemoryRouter>
    );

  it('shows the Admin tab to an administrator', () => {
    mockAuth.current = {
      ...base,
      user: { id: 9, email: 'admin@library.com', role: 'admin' },
      isImpersonating: false,
      impersonator: null,
      isAdmin: true,
    };

    renderNav();

    expect(screen.getAllByText('Admin').length).toBeGreaterThan(0);
  });

  it('hides the Admin tab from a standard user', () => {
    mockAuth.current = {
      ...base,
      user: { id: 3, email: 'plain@library.com', role: 'user' },
      isImpersonating: false,
      impersonator: null,
      isAdmin: false,
    };

    renderNav();

    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('hides the Admin tab while an admin is impersonating, leaving the banner as the way back', () => {
    mockAuth.current = {
      ...base,
      user: { id: 3, email: 'plain@library.com', role: 'user' },
      isImpersonating: true,
      impersonator: { id: 9, email: 'admin@library.com', role: 'admin' },
      isAdmin: false,
    };

    renderNav();

    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    // Removing the tab must not strand the admin: the banner's control is
    // gated on isImpersonating, not isAdmin.
    expect(screen.getByRole('button', { name: /switch back to main profile/i })).toBeInTheDocument();
  });
});
