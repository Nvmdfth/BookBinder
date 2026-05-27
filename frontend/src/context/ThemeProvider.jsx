import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthProvider';

const ThemeContext = createContext();

export const PALETTES = [
  { id: 'indigo', name: 'Indigo Breeze', primary: '#6366f1', secondary: '#a855f7', desc: 'Premium Royal Indigo & Violet accents' },
  { id: 'lavender', name: 'Midnight Lavender', primary: '#7c3aed', secondary: '#db2777', desc: 'Luxurious violet hues and crimson accents' },
  { id: 'emerald', name: 'Emerald Rainforest', primary: '#059669', secondary: '#0d9488', desc: 'Nature-centric emerald and deep teal' },
  { id: 'sunset', name: 'Sunset Oasis', primary: '#ea580c', secondary: '#d97706', desc: 'Warm cozy amber and terracotta' },
  { id: 'cyberpunk', name: 'Cyberpunk Neon', primary: '#d946ef', secondary: '#06b6d4', desc: 'High-contrast glowing synthetic colors' }
];

export function ThemeProvider({ children }) {
  const { user, isAuthenticated, updateUserPreferences } = useAuth();

  // Establish state variables synced with authentication context (defaulting to dark + indigo)
  const [theme, setThemeState] = useState('dark');
  const [palette, setPaletteState] = useState('indigo');

  // Monitor Auth Context loads to inherit database-persisted aesthetics
  useEffect(() => {
    if (isAuthenticated && user) {
      setThemeState(user.theme || 'dark');
      setPaletteState(user.palette || 'indigo');
    } else {
      // Force static defaults for guest users on login/registration views (Dark Mode + Indigo)
      setThemeState('dark');
      setPaletteState('indigo');
    }
  }, [user, isAuthenticated]);

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
