/**
 * PRD §2 requires the RBAC matrix to be enforced at the frontend routing level as
 * well as in backend middleware. These cover the client half of that contract;
 * the server half is covered by backend/tests/adminSettings.test.js.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const mockAuth = vi.hoisted(() => ({ current: {} }));

vi.mock('../context/AuthProvider', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => mockAuth.current,
}));

// Layout pulls in navigation chrome irrelevant to the guard decision
vi.mock('../components/Layout', () => ({
  default: ({ children }) => <div data-testid="layout">{children}</div>,
}));

import { AdminRoute, ProtectedRoute } from '../App';

function renderAt(route, element) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/" element={<div>dashboard</div>} />
        <Route path="/login" element={<div>login page</div>} />
        <Route path="/admin" element={element} />
      </Routes>
    </MemoryRouter>
  );
}

const AdminConsoleStub = () => <div>admin console</div>;

beforeEach(() => {
  mockAuth.current = { isAuthenticated: false, isAdmin: false, loading: false };
});

describe('AdminRoute', () => {
  it('renders the console for an admin', () => {
    mockAuth.current = { isAuthenticated: true, isAdmin: true, loading: false };

    renderAt('/admin', <AdminRoute><AdminConsoleStub /></AdminRoute>);

    expect(screen.getByText('admin console')).toBeInTheDocument();
  });

  it('redirects a standard user to the dashboard instead of rendering the console', () => {
    mockAuth.current = { isAuthenticated: true, isAdmin: false, loading: false };

    renderAt('/admin', <AdminRoute><AdminConsoleStub /></AdminRoute>);

    expect(screen.queryByText('admin console')).not.toBeInTheDocument();
    expect(screen.getByText('dashboard')).toBeInTheDocument();
  });

  it('sends an anonymous visitor to the login page', () => {
    mockAuth.current = { isAuthenticated: false, isAdmin: false, loading: false };

    renderAt('/admin', <AdminRoute><AdminConsoleStub /></AdminRoute>);

    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('waits for session restoration before deciding, so an admin is not bounced on reload', () => {
    // isAdmin is false until /api/auth/me resolves; redirecting here would eject
    // a legitimate admin on every refresh
    mockAuth.current = { isAuthenticated: false, isAdmin: false, loading: true };

    renderAt('/admin', <AdminRoute><AdminConsoleStub /></AdminRoute>);

    expect(screen.queryByText('login page')).not.toBeInTheDocument();
    expect(screen.queryByText('dashboard')).not.toBeInTheDocument();
    expect(screen.getByText(/restoring session/i)).toBeInTheDocument();
  });

  it('wraps the console in the app layout', () => {
    mockAuth.current = { isAuthenticated: true, isAdmin: true, loading: false };

    renderAt('/admin', <AdminRoute><AdminConsoleStub /></AdminRoute>);

    expect(screen.getByTestId('layout')).toBeInTheDocument();
  });
});

describe('ProtectedRoute', () => {
  it('renders for any authenticated user regardless of role', () => {
    mockAuth.current = { isAuthenticated: true, isAdmin: false, loading: false };

    renderAt('/admin', <ProtectedRoute><div>protected content</div></ProtectedRoute>);

    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('redirects an anonymous visitor to login', () => {
    mockAuth.current = { isAuthenticated: false, isAdmin: false, loading: false };

    renderAt('/admin', <ProtectedRoute><div>protected content</div></ProtectedRoute>);

    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('holds the render while the session is being restored', () => {
    mockAuth.current = { isAuthenticated: false, isAdmin: false, loading: true };

    renderAt('/admin', <ProtectedRoute><div>protected content</div></ProtectedRoute>);

    expect(screen.getByText(/restoring session/i)).toBeInTheDocument();
  });
});
