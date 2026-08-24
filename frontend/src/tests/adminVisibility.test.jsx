/**
 * Who counts as an administrator.
 *
 * isAdmin previously also returned true when an admin was *impersonating*
 * someone. The Admin tab therefore stayed in the nav while impersonating, and
 * the console behind it rendered — but every request inside it came back 403,
 * because the server reads the effective role, not the impersonator's. A tab
 * that leads only to failed requests is worse than no tab, and it defeats the
 * purpose of impersonation, which is to see the app as that user sees it.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../context/AuthProvider';

const PLAIN_USER = {
  id: 3, email: 'plain@library.com', role: 'user',
  isImpersonating: false, impersonator: null,
};

const ADMIN = {
  id: 1, email: 'admin@library.com', role: 'admin',
  isImpersonating: false, impersonator: null,
};

/** The shape /api/auth/me returns while an admin is impersonating someone. */
const IMPERSONATED = {
  id: 3, email: 'plain@library.com', role: 'user',
  isImpersonating: true,
  impersonator: { id: 1, email: 'admin@library.com', role: 'admin' },
};

function Probe() {
  const { isAdmin, isImpersonating } = useAuth();
  return (
    <div>
      <span data-testid="is-admin">{String(isAdmin)}</span>
      <span data-testid="is-impersonating">{String(isImpersonating)}</span>
    </div>
  );
}

function renderAs(session) {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(session) })
  );
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('isAdmin', () => {
  it('is true for a real administrator', async () => {
    renderAs(ADMIN);

    await waitFor(() => expect(screen.getByTestId('is-admin')).toHaveTextContent('true'));
  });

  it('is false for a standard user', async () => {
    renderAs(PLAIN_USER);

    await waitFor(() => expect(screen.getByTestId('is-admin')).toHaveTextContent('false'));
  });

  it('is false while an admin impersonates a standard user', async () => {
    renderAs(IMPERSONATED);

    // The server answers 403 to every admin route in this state, so the client
    // must agree that the effective user is not an administrator.
    await waitFor(() => expect(screen.getByTestId('is-impersonating')).toHaveTextContent('true'));
    expect(screen.getByTestId('is-admin')).toHaveTextContent('false');
  });
});
