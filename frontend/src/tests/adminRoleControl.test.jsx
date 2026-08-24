/**
 * Promoting and demoting administrators.
 *
 * The control existed and worked, but was a 14px shield icon whose only text
 * was a title tooltip — so an admin looking for "how do I make someone an
 * admin" reasonably concluded the feature was missing. A destructive,
 * privilege-granting action should say what it does without being hovered.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mockAuth = vi.hoisted(() => ({ current: {} }));

vi.mock('../context/AuthProvider', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => mockAuth.current,
}));

import AdminConsole from '../pages/AdminConsole';

const USERS = [
  { id: 1, email: 'admin@library.com', role: 'admin', is_disabled: false, created_at: '2026-01-01', shelf_count: 0, book_count: 0 },
  { id: 3, email: 'plain@library.com', role: 'user', is_disabled: false, created_at: '2026-01-02', shelf_count: 1, book_count: 4 },
  // A second administrator: the signed-in admin gets no control on their own
  // row, so demotion can only be exercised against somebody else.
  { id: 4, email: 'other-admin@library.com', role: 'admin', is_disabled: false, created_at: '2026-01-03', shelf_count: 0, book_count: 0 },
];

beforeEach(() => {
  mockAuth.current = {
    user: { id: 1, email: 'admin@library.com', role: 'admin' },
    isAdmin: true,
    impersonateUser: vi.fn(),
  };

  global.fetch = vi.fn((url, options = {}) => {
    const u = String(url);
    if (u === '/api/settings' && (options.method || 'GET') === 'GET') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ allow_open_registration: 'false' }) });
    }
    if (u.includes('/orphans')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ count: 0, orphans: [] }) });
    }
    if (u.includes('/api/admin/tokens')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    if (u.includes('/users') && !options.method) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(USERS) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });

  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => vi.restoreAllMocks());

const renderConsole = () =>
  render(
    <MemoryRouter>
      <AdminConsole />
    </MemoryRouter>
  );

describe('Role control discoverability', () => {
  it('offers a control that says it promotes, without needing a hover', async () => {
    renderConsole();

    expect(
      await screen.findByRole('button', { name: /make .*admin|promote/i })
    ).toBeInTheDocument();
  });

  it('offers the reverse for an existing administrator', async () => {
    renderConsole();

    expect(
      await screen.findByRole('button', { name: /remove admin|demote/i })
    ).toBeInTheDocument();
  });
});

describe('Changing a role', () => {
  it('confirms first, then calls the role endpoint with the new role', async () => {
    renderConsole();

    await userEvent.click(await screen.findByRole('button', { name: /make .*admin|promote/i }));

    expect(window.confirm).toHaveBeenCalled();

    await waitFor(() => {
      const call = global.fetch.mock.calls.find(([u, o]) => String(u).includes('/role') && o?.method === 'PUT');
      expect(call).toBeTruthy();
      expect(JSON.parse(call[1].body)).toEqual({ role: 'admin' });
    });
  });

  it('does nothing when the confirmation is declined', async () => {
    window.confirm.mockReturnValue(false);
    renderConsole();

    await userEvent.click(await screen.findByRole('button', { name: /make .*admin|promote/i }));

    const call = global.fetch.mock.calls.find(([u, o]) => String(u).includes('/role') && o?.method === 'PUT');
    expect(call).toBeUndefined();
  });
});

describe('The label is visible, not just a tooltip', () => {
  it('renders the promote action as readable text on the page', async () => {
    renderConsole();

    // getByText matches rendered text nodes only. A title attribute satisfies
    // getByRole's accessible-name lookup but is invisible until hovered, which
    // is exactly how this control went unnoticed.
    expect(await screen.findByText(/make admin/i)).toBeInTheDocument();
  });

  it('renders the demote action as readable text too', async () => {
    renderConsole();

    expect(await screen.findByText(/remove admin/i)).toBeInTheDocument();
  });
});
