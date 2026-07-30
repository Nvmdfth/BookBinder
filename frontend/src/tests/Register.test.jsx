/**
 * Req 4.4.2 — when the instance is closed, the registration view must hide its
 * inputs and show the exact fallback message.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockAuth = vi.hoisted(() => ({ current: {} }));

vi.mock('../context/AuthProvider', () => ({
  useAuth: () => mockAuth.current,
}));

import Register from '../pages/Register';

const LOCKED_MESSAGE =
  'Public registration is currently disabled on this instance. Please contact your system administrator for access.';

/** Stub the status endpoint the view consults on mount. */
function stubRegistrationStatus(allowOpenRegistration, { reject = false } = {}) {
  const fetchMock = vi.fn().mockImplementation((url) => {
    if (String(url).includes('/api/auth/registration-status')) {
      if (reject) return Promise.reject(new Error('network down'));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          allowOpenRegistration,
          message: allowOpenRegistration ? null : LOCKED_MESSAGE,
        }),
      });
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
  global.fetch = fetchMock;
  return fetchMock;
}

function renderRegister() {
  return render(
    <MemoryRouter>
      <Register />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockAuth.current = { register: vi.fn().mockResolvedValue({}) };
});

describe('Closed instance (Req 4.4.2)', () => {
  it('shows the exact PRD fallback message', async () => {
    stubRegistrationStatus(false);

    renderRegister();

    expect(await screen.findByText(LOCKED_MESSAGE)).toBeInTheDocument();
  });

  it('hides every credential input and the submit control', async () => {
    stubRegistrationStatus(false);

    renderRegister();

    await screen.findByText(LOCKED_MESSAGE);
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(document.querySelectorAll('input')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /register/i })).not.toBeInTheDocument();
  });

  it('offers a route back to sign-in', async () => {
    stubRegistrationStatus(false);

    renderRegister();

    expect(await screen.findByText(/return to sign in/i)).toBeInTheDocument();
  });

  it('fails closed when the status probe errors', async () => {
    stubRegistrationStatus(false, { reject: true });

    renderRegister();

    expect(await screen.findByText(LOCKED_MESSAGE)).toBeInTheDocument();
  });

  it('reads the state from the dedicated status endpoint, not by posting an empty registration', async () => {
    // Regression guard: probing with POST /api/auth/register returned 400 for a
    // missing payload, so the lock was never detected and the form always showed.
    const fetchMock = stubRegistrationStatus(false);

    renderRegister();

    await screen.findByText(LOCKED_MESSAGE);
    const calls = fetchMock.mock.calls.map(([url, opts]) => ({ url: String(url), method: opts?.method }));
    expect(calls.some((c) => c.url.includes('/api/auth/registration-status'))).toBe(true);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('Open instance', () => {
  it('renders the registration form', async () => {
    stubRegistrationStatus(true);

    renderRegister();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /register/i })).toBeInTheDocument();
    });
    expect(screen.queryByText(LOCKED_MESSAGE)).not.toBeInTheDocument();
  });

  it('exposes email, password and confirmation fields', async () => {
    stubRegistrationStatus(true);

    renderRegister();

    await waitFor(() => expect(document.querySelectorAll('input')).toHaveLength(3));
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(2);
  });
});
