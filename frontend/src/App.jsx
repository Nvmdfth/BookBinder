import React, { useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthProvider';
import { ThemeProvider, useTheme } from './context/ThemeProvider';
import Layout from './components/Layout';
import { createTheme, ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

// Pages
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import BookshelfDetails from './pages/BookshelfDetails';
import ProfileSettings from './pages/ProfileSettings';
import AdminConsole from './pages/AdminConsole';

/**
 * Route protection wrapper validating active sessions
 */
function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div style={styles.loadingScreen}>
        <div className="skeleton" style={{ width: '80px', height: '80px', borderRadius: '50%' }}></div>
        <p style={{ marginTop: '16px', fontWeight: '600', color: 'var(--text-muted)' }}>Restoring session...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Layout>{children}</Layout>;
}

/**
 * Unprotected routes wrapper redirecting already logged-in users to home
 */
function PublicRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return null;

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return children;
}

/**
 * Dynamic MUI Theme Bridge mapping custom palette values to MUI component design tokens
 */
function MUIThemeBridge({ children }) {
  const { theme, palette } = useTheme();

  const muiTheme = useMemo(() => {
    const isDark = theme === 'dark';
    
    // Map colors dynamically based on active palette and theme
    let primaryColor = '#6366f1';
    let secondaryColor = '#a855f7';
    let bgColor = isDark ? '#121212' : '#f8fafc';
    let paperColor = isDark ? '#1a1a1a' : '#ffffff';

    if (palette === 'lavender') {
      primaryColor = isDark ? '#a78bfa' : '#7c3aed';
      secondaryColor = isDark ? '#f472b6' : '#db2777';
      bgColor = isDark ? '#0b0713' : '#faf8ff';
      paperColor = isDark ? '#140e22' : '#ffffff';
    } else if (palette === 'emerald') {
      primaryColor = isDark ? '#34d399' : '#059669';
      secondaryColor = isDark ? '#2dd4bf' : '#0d9488';
      bgColor = isDark ? '#04100b' : '#f4fcf7';
      paperColor = isDark ? '#0a1b14' : '#ffffff';
    } else if (palette === 'sunset') {
      primaryColor = isDark ? '#fb923c' : '#ea580c';
      secondaryColor = isDark ? '#fbbf24' : '#d97706';
      bgColor = isDark ? '#120c04' : '#fdfaf7';
      paperColor = isDark ? '#1f140a' : '#ffffff';
    } else if (palette === 'cyberpunk') {
      primaryColor = isDark ? '#f43f5e' : '#d946ef';
      secondaryColor = isDark ? '#06b6d4' : '#06b6d4';
      bgColor = isDark ? '#030008' : '#fcfaff';
      paperColor = isDark ? '#0d011a' : '#ffffff';
    }

    return createTheme({
      palette: {
        mode: theme,
        primary: {
          main: primaryColor,
        },
        secondary: {
          main: secondaryColor,
        },
        background: {
          default: bgColor,
          paper: paperColor,
        },
        text: {
          primary: isDark ? '#f8fafc' : '#0f172a',
          secondary: isDark ? '#cbd5e1' : '#475569',
        }
      },
      typography: {
        fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        h1: { fontFamily: "'Outfit', sans-serif", fontWeight: 700 },
        h2: { fontFamily: "'Outfit', sans-serif", fontWeight: 700 },
        h3: { fontFamily: "'Outfit', sans-serif", fontWeight: 700 },
        h4: { fontFamily: "'Outfit', sans-serif", fontWeight: 700 },
        h5: { fontFamily: "'Outfit', sans-serif", fontWeight: 700 },
        h6: { fontFamily: "'Outfit', sans-serif", fontWeight: 600 },
        button: { textTransform: 'none', fontWeight: 600 }
      },
      shape: {
        borderRadius: 12, // Align with BookBinder glass panel shapes
      },
      components: {
        MuiButton: {
          styleOverrides: {
            root: {
              borderRadius: 8,
              padding: '10px 20px',
              transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
              '&:hover': {
                transform: 'scale(1.02)',
              }
            }
          }
        },
        MuiCard: {
          styleOverrides: {
            root: {
              backgroundImage: 'none',
              border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(226,232,240,0.8)'}`,
              backdropFilter: 'blur(16px)',
              backgroundColor: isDark ? 'rgba(26,26,26,0.7)' : 'rgba(255,255,255,0.7)',
            }
          }
        }
      }
    });
  }, [theme, palette]);

  return (
    <MuiThemeProvider theme={muiTheme}>
      <CssBaseline enableColorScheme />
      {children}
    </MuiThemeProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <MUIThemeBridge>
          <BrowserRouter>
            <Routes>
              {/* Authentications Entry Portals */}
              <Route 
                path="/login" 
                element = {
                  <PublicRoute>
                    <Login />
                  </PublicRoute>
                } 
              />
              <Route 
                path="/register" 
                element = {
                  <PublicRoute>
                    <Register />
                  </PublicRoute>
                } 
              />

              {/* Protected Workspace Layouts */}
              <Route 
                path="/" 
                element = {
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                } 
              />
              
              <Route 
                path="/bookshelves/:id" 
                element = {
                  <ProtectedRoute>
                    <BookshelfDetails />
                  </ProtectedRoute>
                } 
              />

              <Route 
                path="/profile" 
                element = {
                  <ProtectedRoute>
                    <ProfileSettings />
                  </ProtectedRoute>
                } 
              />

              <Route 
                path="/admin" 
                element = {
                  <ProtectedRoute>
                    <AdminConsole />
                  </ProtectedRoute>
                } 
              />

              {/* Catch-all navigation fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </MUIThemeBridge>
      </ThemeProvider>
    </AuthProvider>
  );
}

const styles = {
  loadingScreen: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    width: '100vw',
    backgroundColor: 'var(--bg-primary)',
  },
};
