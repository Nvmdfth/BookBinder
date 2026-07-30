import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';
import { useTheme } from '../context/ThemeProvider';
import { BookMarked, User, ShieldAlert, Sun, Moon, LogOut } from 'lucide-react';

export default function Layout({ children }) {
  const { user, logout, isAdmin } = useAuth();
  const { toggleTheme, isDark } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Initials for the avatar fallback
  const getInitials = (email) => {
    if (!email) return 'B';
    return email.split('@')[0].slice(0, 2).toUpperCase();
  };

  const menuItems = [
    { name: 'Catalog', path: '/', icon: <BookMarked size={20} /> },
    { name: 'Profile', path: '/profile', icon: <User size={20} /> },
  ];

  // Admin console route mount (Req 4.4.3)
  if (isAdmin) {
    menuItems.push({ name: 'Admin', path: '/admin', icon: <ShieldAlert size={20} /> });
  }

  const isActiveRoute = (path) => location.pathname === path;

  const brand = (compact = false) => (
    <div style={styles.brand}>
      <BookMarked size={compact ? 20 : 24} style={{ color: 'var(--accent-color)' }} />
      <div style={styles.brandText}>
        <span style={{ ...styles.brandName, fontSize: compact ? '1.05rem' : '1.3rem' }}>
          BookBinder
        </span>
        {!compact && <span className="eyebrow" style={styles.brandSub}>Home Catalog</span>}
      </div>
    </div>
  );

  return (
    <div className="app-shell">
      {/* Desktop sidebar */}
      <aside className="app-sidebar">
        {brand()}

        <hr className="rule-double" />

        {/* Borrower card */}
        <div style={styles.userCard}>
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="" style={styles.avatarImg} />
          ) : (
            <div style={styles.avatarFallback}>{getInitials(user?.email)}</div>
          )}
          <div style={styles.userInfo}>
            <span style={styles.userEmail} title={user?.email}>{user?.email}</span>
            <span className="stamp stamp-muted" style={styles.roleStamp}>{user?.role}</span>
          </div>
        </div>

        <nav style={styles.navMenu}>
          <span className="eyebrow" style={styles.navHeading}>Sections</span>
          {menuItems.map((item) => (
            <Link
              key={item.name}
              to={item.path}
              className={`nav-link${isActiveRoute(item.path) ? ' nav-link-active' : ''}`}
            >
              {item.icon}
              <span>{item.name}</span>
            </Link>
          ))}
        </nav>

        <div style={styles.sidebarFooter}>
          <button className="btn btn-ghost" style={styles.footerBtn} onClick={toggleTheme}>
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
            <span>{isDark ? 'Daylight' : 'Reading Lamp'}</span>
          </button>

          <button
            className="btn btn-ghost"
            style={{ ...styles.footerBtn, color: 'var(--danger-color)' }}
            onClick={handleLogout}
          >
            <LogOut size={18} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="app-mobile-header">
        {brand(true)}
        <div style={styles.mobileActions}>
          <button
            className="btn btn-ghost"
            style={styles.iconBtn}
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            className="btn btn-ghost"
            style={{ ...styles.iconBtn, color: 'var(--danger-color)' }}
            onClick={handleLogout}
            aria-label="Sign out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="app-main">
        <div className="app-content">{children}</div>
      </main>

      {/* Sticky thumb-reachable tray (Req 4.1.1) */}
      <nav className="app-bottom-tray">
        {menuItems.map((item) => (
          <Link
            key={item.name}
            to={item.path}
            className={`tray-link${isActiveRoute(item.path) ? ' tray-link-active' : ''}`}
          >
            {item.icon}
            <span>{item.name}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

const styles = {
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  brandText: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1.15,
  },
  brandName: {
    fontFamily: 'var(--font-display)',
    fontWeight: 600,
    letterSpacing: '-0.02em',
    color: 'var(--text-primary)',
  },
  brandSub: {
    fontSize: '0.6rem',
    marginTop: '2px',
  },
  userCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--rule)',
    marginBottom: '22px',
  },
  avatarImg: {
    width: '38px',
    height: '38px',
    borderRadius: 'var(--radius-xs)',
    objectFit: 'cover',
    border: '1px solid var(--rule)',
    flexShrink: 0,
  },
  avatarFallback: {
    width: '38px',
    height: '38px',
    borderRadius: 'var(--radius-xs)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--accent-color)',
    color: 'var(--bg-secondary)',
    fontFamily: 'var(--font-stamp)',
    fontSize: '0.8rem',
    fontWeight: 700,
    flexShrink: 0,
  },
  userInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    overflow: 'hidden',
    alignItems: 'flex-start',
  },
  userEmail: {
    fontSize: '0.8rem',
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '160px',
    color: 'var(--text-primary)',
  },
  roleStamp: {
    fontSize: '0.55rem',
    padding: '1px 6px',
  },
  navMenu: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    flex: 1,
  },
  navHeading: {
    fontSize: '0.6rem',
    marginBottom: '8px',
    paddingLeft: '13px',
  },
  sidebarFooter: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    paddingTop: '14px',
    borderTop: '1px solid var(--rule)',
  },
  footerBtn: {
    justifyContent: 'flex-start',
    width: '100%',
    minHeight: '38px',
    padding: '8px 13px',
    fontSize: '0.85rem',
  },
  mobileActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
  },
  iconBtn: {
    minHeight: '36px',
    padding: '8px',
  },
};
