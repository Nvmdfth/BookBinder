import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';
import { useTheme } from '../context/ThemeProvider';
import { Library, User, ShieldAlert, Sun, Moon, LogOut } from 'lucide-react';

export default function Layout({ children }) {
  const { user, logout, isAdmin } = useAuth();
  const { theme, toggleTheme, isDark } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Helper resolving user initials for HSL avatar fallback
  const getInitials = (email) => {
    if (!email) return 'B';
    return email.split('@')[0].slice(0, 2).toUpperCase();
  };

  const menuItems = [
    { name: 'Dashboard', path: '/', icon: <Library size={22} /> },
    { name: 'Profile', path: '/profile', icon: <User size={22} /> },
  ];

  // Admins audit console route mount (Req 4.4.3)
  if (isAdmin) {
    menuItems.push({ name: 'Admin', path: '/admin', icon: <ShieldAlert size={22} /> });
  }

  const isActiveRoute = (path) => location.pathname === path;

  return (
    <div style={styles.layoutContainer}>
      {/* 🖥️ Desktop Navigation Sidebar (>= 768px in responsive flow) */}
      <aside style={styles.sidebar} className="glass-panel">
        <div style={styles.brandRow}>
          <Library size={28} style={styles.brandLogo} />
          <h2 style={styles.brandName}>BookBinder</h2>
        </div>

        {/* User Card */}
        <div style={styles.userCard}>
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="User avatar" style={styles.avatarImg} />
          ) : (
            <div style={styles.avatarFallback}>{getInitials(user?.email)}</div>
          )}
          <div style={styles.userInfo}>
            <span style={styles.userEmail} title={user?.email}>{user?.email}</span>
            <span style={styles.userRole}>{user?.role}</span>
          </div>
        </div>

        {/* Menu Links */}
        <nav style={styles.navMenu}>
          {menuItems.map((item) => (
            <Link
              key={item.name}
              to={item.path}
              style={{
                ...styles.navLink,
                ...(isActiveRoute(item.path) ? styles.navLinkActive : {}),
              }}
            >
              {item.icon}
              <span>{item.name}</span>
            </Link>
          ))}
        </nav>

        {/* Footer Actions */}
        <div style={styles.sidebarFooter}>
          <button style={styles.sidebarActionBtn} onClick={toggleTheme} title="Switch Themes">
            {isDark ? <Sun size={20} /> : <Moon size={20} />}
            <span>{isDark ? 'Light Theme' : 'Dark Theme'}</span>
          </button>
          
          <button style={{ ...styles.sidebarActionBtn, ...styles.logoutBtn }} onClick={handleLogout}>
            <LogOut size={20} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* 📱 Mobile Top/Header Bar */}
      <header style={styles.mobileHeader} className="glass-panel">
        <div style={styles.brandRow}>
          <Library size={24} style={styles.brandLogo} />
          <h2 style={{ ...styles.brandName, fontSize: '1.25rem' }}>BookBinder</h2>
        </div>

        {/* Mobile Header Icons */}
        <div style={styles.mobileHeaderActions}>
          <button style={styles.mobileHeaderBtn} onClick={toggleTheme}>
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          
          <button style={{ ...styles.mobileHeaderBtn, color: 'var(--danger-color)' }} onClick={handleLogout} title="Sign Out">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={styles.mainContent}>
        <div style={styles.contentWrapper}>
          {children}
        </div>
      </main>

      {/* 📱 Mobile Sticky Bottom Navigation Tray (Req 4.1.1) */}
      <nav style={styles.mobileBottomTray} className="glass-panel">
        {menuItems.map((item) => (
          <Link
            key={item.name}
            to={item.path}
            style={{
              ...styles.mobileTrayLink,
              ...(isActiveRoute(item.path) ? styles.mobileTrayLinkActive : {}),
            }}
          >
            {item.icon}
            <span style={styles.trayLabel}>{item.name}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

const styles = {
  layoutContainer: {
    display: 'flex',
    minHeight: '100vh',
    width: '100vw',
  },
  sidebar: {
    width: '280px',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    position: 'fixed',
    top: '20px',
    left: '20px',
    bottom: '20px',
    zIndex: 100,
    borderRadius: 'var(--radius-lg)',
    backgroundColor: 'var(--bg-glass)',
    border: '1px solid var(--border-glass)',
    // Responsive block for styling reflow (handled by CSS, but defined here for base)
    '@media (max-width: 768px)': {
      display: 'none',
    },
  },
  brandRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '32px',
  },
  brandLogo: {
    color: 'var(--accent-color)',
  },
  brandName: {
    fontSize: '1.5rem',
    fontWeight: 800,
    background: 'var(--accent-gradient)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  userCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--bg-primary)',
    marginBottom: '24px',
    border: '1px solid var(--border-glass)',
  },
  avatarImg: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    objectFit: 'cover',
    border: '2px solid var(--accent-color)',
  },
  avatarFallback: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--accent-gradient)',
    color: '#ffffff',
    fontSize: '0.9rem',
    fontWeight: '700',
  },
  userInfo: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  userEmail: {
    fontSize: '0.85rem',
    fontWeight: '600',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text-primary)',
  },
  userRole: {
    fontSize: '0.75rem',
    color: 'var(--accent-color)',
    textTransform: 'uppercase',
    fontWeight: '700',
    letterSpacing: '0.05em',
  },
  navMenu: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    flex: 1,
  },
  navLink: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-secondary)',
    fontWeight: '600',
    transition: 'var(--transition-smooth)',
  },
  navLinkActive: {
    backgroundColor: 'var(--accent-light)',
    color: 'var(--accent-color)',
    boxShadow: 'var(--shadow-sm)',
  },
  sidebarFooter: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    paddingTop: '16px',
    borderTop: '1px solid var(--border-glass)',
  },
  sidebarActionBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 16px',
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    width: '100%',
    borderRadius: 'var(--radius-sm)',
    fontWeight: '600',
    textAlign: 'left',
    transition: 'var(--transition-smooth)',
  },
  logoutBtn: {
    color: 'var(--danger-color)',
  },
  logoutBtnHover: {
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
  },
  mobileHeader: {
    display: 'none', // CSS handles visibility reflow
    height: '60px',
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 90,
    padding: '0 16px',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 0,
    borderBottom: '1px solid var(--border-glass)',
  },
  mobileHeaderActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  mobileHeaderBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    padding: '6px',
    display: 'flex',
    alignItems: 'center',
  },
  mobileBottomTray: {
    display: 'none', // Sticky bottom bar (Req 4.1.1)
    height: '64px',
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 90,
    borderRadius: 0,
    borderTop: '1px solid var(--border-glass)',
    backgroundColor: 'var(--bg-glass)',
    backdropFilter: 'blur(16px)',
    justifyContent: 'space-around',
    alignItems: 'center',
    padding: '0 12px',
  },
  mobileTrayLink: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)',
    fontSize: '0.7rem',
    fontWeight: '600',
    gap: '2px',
    flex: 1,
    height: '100%',
  },
  mobileTrayLinkActive: {
    color: 'var(--accent-color)',
  },
  trayLabel: {
    fontSize: '0.7rem',
  },
  mainContent: {
    flex: 1,
    padding: '40px',
    marginLeft: '320px', // Clear fixed sidebar
    minHeight: '100vh',
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
  },
  contentWrapper: {
    width: '100%',
    maxWidth: '1200px',
  },
};

// Inject simple CSS directly to handle standard screen reflow rules perfectly
const styleElement = document.createElement('style');
styleElement.innerHTML = `
  @media (max-width: 768px) {
    aside { display: none !important; }
    header { display: flex !important; }
    nav.glass-panel { display: flex !important; }
    main { 
      margin-left: 0 !important; 
      padding: 80px 16px 84px 16px !important; 
    }
  }
`;
document.head.appendChild(styleElement);
