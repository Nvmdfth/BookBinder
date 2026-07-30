import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthProvider';

const ThemeContext = createContext();

/**
 * Binding cloths — the accent applied to spines, stamps and controls.
 *
 * The ids are persisted in users.palette, so they stay fixed even though the
 * names and swatches are now drawn from bookbinding materials. Swatch values
 * mirror the light-theme --accent-color in index.css.
 */
export const PALETTES = [
  { id: 'indigo', name: 'Library Buckram', primary: '#3a4a9f', secondary: '#55407f', desc: 'Indigo cloth, the classic lending-library binding' },
  { id: 'lavender', name: 'Marbled Endpaper', primary: '#7a3f8f', secondary: '#a33b6b', desc: 'Violet and rose swirls from a hand-marbled sheet' },
  { id: 'emerald', name: 'Morocco Green', primary: '#2f6b45', secondary: '#2c6360', desc: 'Deep green goatskin with a soft teal cast' },
  { id: 'sunset', name: 'Foxed Calfskin', primary: '#9a5a17', secondary: '#8a5320', desc: 'Warm tan leather aged to amber' },
  { id: 'cyberpunk', name: 'Crimson Cloth', primary: '#a02f36', secondary: '#85304c', desc: 'Oxblood red boards with a plum spine' }
];

/**
 * Mirror the OS-level colour scheme preference (Req 4.1.2). Falls back to dark on
 * engines without matchMedia support.
 */
export function resolveSystemTheme() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
  const { user, isAuthenticated, updateUserPreferences } = useAuth();

  // Initialize from the OS preference; a signed-in user's stored choice overrides it below
  const [theme, setThemeState] = useState(resolveSystemTheme);
  const [palette, setPaletteState] = useState('indigo');

  // Monitor Auth Context loads to inherit database-persisted aesthetics
  useEffect(() => {
    if (isAuthenticated && user) {
      setThemeState(user.theme || resolveSystemTheme());
      setPaletteState(user.palette || 'indigo');
    } else {
      // Guests on login/registration views track the OS preference
      setThemeState(resolveSystemTheme());
      setPaletteState('indigo');
    }
  }, [user, isAuthenticated]);

  // Track live OS preference changes while no explicit user preference is stored
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    if (isAuthenticated && user?.theme) return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => setThemeState(e.matches ? 'dark' : 'light');

    // addEventListener is unavailable on older Safari MediaQueryList implementations
    if (mq.addEventListener) {
      mq.addEventListener('change', handleChange);
      return () => mq.removeEventListener('change', handleChange);
    }
    mq.addListener(handleChange);
    return () => mq.removeListener(handleChange);
  }, [isAuthenticated, user?.theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-palette', palette);
  }, [theme, palette]);

  const updatePreferences = async (newTheme, newPalette) => {
    setThemeState(newTheme);
    setPaletteState(newPalette);
    
    if (isAuthenticated) {
      try {
        await updateUserPreferences(newTheme, newPalette);
      } catch (err) {
        console.error('Failed to sync theme preferences to database:', err);
      }
    }
  };

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    updatePreferences(nextTheme, palette);
  };

  const setPalette = (nextPalette) => {
    updatePreferences(theme, nextPalette);
  };

  const setTheme = (nextTheme) => {
    updatePreferences(nextTheme, palette);
  };

  return (
    <ThemeContext.Provider value={{ 
      theme, 
      setTheme,
      palette, 
      setPalette,
      toggleTheme, 
      isDark: theme === 'dark',
      availablePalettes: PALETTES
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
