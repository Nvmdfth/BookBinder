/**
 * Req 4.1.2 — default initialization must mirror the OS colour scheme via
 * window.matchMedia, and a signed-in user's stored preference must override it.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockAuth = vi.hoisted(() => ({ current: {} }));

vi.mock('../context/AuthProvider', () => ({
  useAuth: () => mockAuth.current,
}));

import { ThemeProvider, useTheme, resolveSystemTheme } from '../context/ThemeProvider';
import { setPrefersDark } from './setup';

function ThemeProbe() {
  const { theme, palette, toggleTheme, setPalette } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="palette">{palette}</span>
      <button onClick={toggleTheme}>toggle</button>
      <button onClick={() => setPalette('emerald')}>emerald</button>
    </div>
  );
}

function renderTheme() {
  return render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>
  );
}

beforeEach(() => {
  mockAuth.current = {
    user: null,
    isAuthenticated: false,
    updateUserPreferences: vi.fn().mockResolvedValue({}),
  };
});

describe('resolveSystemTheme', () => {
  it('reports dark when the OS prefers dark', () => {
    setPrefersDark(true);
    expect(resolveSystemTheme()).toBe('dark');
  });

  it('reports light when the OS prefers light', () => {
    setPrefersDark(false);
    expect(resolveSystemTheme()).toBe('light');
  });

  it('falls back to dark where matchMedia is unavailable', () => {
    const original = window.matchMedia;
    delete window.matchMedia;

    expect(resolveSystemTheme()).toBe('dark');

    window.matchMedia = original;
  });
});

describe('Guest theme initialization mirrors the OS (Req 4.1.2)', () => {
  it('starts in light mode when the OS prefers light', async () => {
    setPrefersDark(false);

    renderTheme();

    await waitFor(() => expect(screen.getByTestId('theme')).toHaveTextContent('light'));
  });

  it('starts in dark mode when the OS prefers dark', async () => {
    setPrefersDark(true);

    renderTheme();

    await waitFor(() => expect(screen.getByTestId('theme')).toHaveTextContent('dark'));
  });

  it('queries the prefers-color-scheme media feature by name', () => {
    setPrefersDark(true);

    renderTheme();

    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
  });

  it('publishes the resolved theme onto the document root for the CSS variables', async () => {
    setPrefersDark(false);

    renderTheme();

    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect(document.documentElement.getAttribute('data-palette')).toBe('indigo');
    });
  });
});

describe('A signed-in user’s stored preference wins over the OS', () => {
  it('applies the persisted theme and palette', async () => {
    setPrefersDark(true);
    mockAuth.current = {
      user: { id: 1, theme: 'light', palette: 'sunset' },
      isAuthenticated: true,
      updateUserPreferences: vi.fn().mockResolvedValue({}),
    };

    renderTheme();

    await waitFor(() => {
      expect(screen.getByTestId('theme')).toHaveTextContent('light');
      expect(screen.getByTestId('palette')).toHaveTextContent('sunset');
    });
  });

  it('falls back to the OS preference when the account has no stored theme', async () => {
    setPrefersDark(true);
    mockAuth.current = {
      user: { id: 1, theme: null, palette: null },
      isAuthenticated: true,
      updateUserPreferences: vi.fn().mockResolvedValue({}),
    };

    renderTheme();

    await waitFor(() => expect(screen.getByTestId('theme')).toHaveTextContent('dark'));
  });
});

describe('Theme changes persist to the database', () => {
  it('sends the toggled theme for an authenticated user', async () => {
    setPrefersDark(true);
    const updateUserPreferences = vi.fn().mockResolvedValue({});
    mockAuth.current = {
      user: { id: 1, theme: 'dark', palette: 'indigo' },
      isAuthenticated: true,
      updateUserPreferences,
    };

    renderTheme();
    await userEvent.click(screen.getByText('toggle'));

    expect(updateUserPreferences).toHaveBeenCalledWith('light', 'indigo');
  });

  it('sends the selected palette alongside the current theme', async () => {
    const updateUserPreferences = vi.fn().mockResolvedValue({});
    mockAuth.current = {
      user: { id: 1, theme: 'dark', palette: 'indigo' },
      isAuthenticated: true,
      updateUserPreferences,
    };

    renderTheme();
    await userEvent.click(screen.getByText('emerald'));

    expect(updateUserPreferences).toHaveBeenCalledWith('dark', 'emerald');
  });

  it('does not attempt to persist preferences for a guest', async () => {
    const updateUserPreferences = vi.fn();
    mockAuth.current = { user: null, isAuthenticated: false, updateUserPreferences };

    renderTheme();
    await userEvent.click(screen.getByText('toggle'));

    expect(updateUserPreferences).not.toHaveBeenCalled();
  });

  it('keeps the UI on the chosen theme even if the persistence call fails', async () => {
    setPrefersDark(true);
    mockAuth.current = {
      user: { id: 1, theme: 'dark', palette: 'indigo' },
      isAuthenticated: true,
      updateUserPreferences: vi.fn().mockRejectedValue(new Error('offline')),
    };

    renderTheme();
    await userEvent.click(screen.getByText('toggle'));

    await waitFor(() => expect(screen.getByTestId('theme')).toHaveTextContent('light'));
  });
});
