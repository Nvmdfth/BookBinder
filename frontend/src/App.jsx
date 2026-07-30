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
export function ProtectedRoute({ children }) {
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
 * Admin-tier route wrapper. PRD §2 requires the RBAC matrix to be enforced at the
 * frontend routing level as well as in backend middleware, so standard users are
 * bounced home rather than shown a console whose every request would 403.
 */
export function AdminRoute({ children }) {
  const { isAuthenticated, isAdmin, loading } = useAuth();

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

  if (!isAdmin) {
    return <Navigate to="/" replace />;
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
/**
 * Reads the design tokens for a given theme/palette straight out of index.css.
 *
 * The palette rules are plain attribute selectors, so they apply to any element
 * carrying the attributes — not just :root. Measuring an off-screen probe keeps
 * the values correct regardless of when ThemeProvider stamps the real document,
 * and leaves the stylesheet as the single source of truth for colour.
 */
function readPaletteTokens(theme, palette) {
  const TOKENS = ['--accent-color', '--bg-primary', '--bg-secondary', '--text-primary', '--text-secondary'];
  const fallback = {
    '--accent-color': '#3a4a9f',
    '--bg-primary': theme === 'dark' ? '#121212' : '#f4efe3',
    '--bg-secondary': theme === 'dark' ? '#1e1e1e' : '#fffcf5',
    '--text-primary': theme === 'dark' ? '#f5f1e8' : '#1c1712',
    '--text-secondary': theme === 'dark' ? '#cfc7b8' : '#4a4136',
  };

  if (typeof document === 'undefined') return fallback;

  const probe = document.createElement('div');
  probe.setAttribute('data-theme', theme);
  probe.setAttribute('data-palette', palette);
  probe.style.display = 'none';
  document.body.appendChild(probe);

  try {
    const computed = getComputedStyle(probe);
    const out = {};
    for (const token of TOKENS) {
      out[token] = computed.getPropertyValue(token).trim() || fallback[token];
    }
    return out;
  } finally {
    probe.remove();
  }
}

function MUIThemeBridge({ children }) {
  const { theme, palette } = useTheme();

  const muiTheme = useMemo(() => {
    const t = readPaletteTokens(theme, palette);

    return createTheme({
      palette: {
        mode: theme,
        primary: {
          main: t['--accent-color'],
        },
        secondary: {
          main: t['--accent-color'],
        },
        background: {
          default: t['--bg-primary'],
          paper: t['--bg-secondary'],
        },
        text: {
          primary: t['--text-primary'],
          secondary: t['--text-secondary'],
        }
      },
      typography: {
        fontFamily: 'var(--font-body)',
        h1: { fontFamily: 'var(--font-display)', fontWeight: 600 },
        h2: { fontFamily: 'var(--font-display)', fontWeight: 600 },
        h3: { fontFamily: 'var(--font-display)', fontWeight: 600 },
        h4: { fontFamily: 'var(--font-display)', fontWeight: 600 },
        h5: { fontFamily: 'var(--font-display)', fontWeight: 600 },
        h6: { fontFamily: 'var(--font-display)', fontWeight: 600 },
        button: { textTransform: 'none', fontWeight: 600 }
      },
      shape: {
        borderRadius: 8, // Matches --radius-md
      },
      components: {
        MuiButton: {
          styleOverrides: {
            root: {
              borderRadius: 5, // --radius-sm
              padding: '10px 20px',
              transition: 'var(--transition-smooth)',
              '&:hover': {
                transform: 'translateY(-1px)',
              }
            }
          }
        },
        MuiCard: {
          // Match the flat card stock of .card — no translucency, no blur
          styleOverrides: {
            root: {
              backgroundImage: 'none',
              border: '1px solid var(--rule)',
              backgroundColor: 'var(--bg-secondary)',
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
                  <AdminRoute>
                    <AdminConsole />
                  </AdminRoute>
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
